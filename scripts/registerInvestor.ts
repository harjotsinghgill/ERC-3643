import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import loadEnv, { requireEnvVar, getRegistrationAgentWallet, getInfraDeployerWallet } from './utils/env';
import { ClaimScheme, getClaimTopic } from './utils/constants';

loadEnv();

interface InvestorRegistration {
  investorAddress: string;
  country: number;
  identityAddress: string;
  salt?: string; // Salt used for CREATE2 identity deployment
  claims: Array<{
    topic: string;
    data: string;
    signature: string;
  }>;
}

/**
 * Register an investor in a token's Identity Registry
 * This should be called AFTER the user has completed KYC in Sumsub
 */
async function registerInvestor(tokenAddress: string, investorWallet: string, country: number, claimData?: string): Promise<InvestorRegistration> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        INVESTOR REGISTRATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const registrar = await getRegistrationAgentWallet();
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  console.log('📋 Registration Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Registrar:', registrar.address);
  console.log('   Token:', tokenAddress);
  console.log('   Investor:', investorWallet);
  console.log('   Country Code:', country, '\n');

  // ========================================================================
  // STEP 1: Load Infrastructure
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Loading Contracts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load claim issuer deployment
  const claimIssuerPath = path.join(__dirname, '..', 'deployments', `claim-issuer-${networkName}-latest.json`);
  if (!fs.existsSync(claimIssuerPath)) {
    throw new Error(`Claim issuer not found. Run deployClaimIssuer.ts first!`);
  }
  const claimIssuerData = JSON.parse(fs.readFileSync(claimIssuerPath, 'utf8'));

  // Load infrastructure for identity factory
  const infraPath = path.join(__dirname, '..', 'deployments', `${networkName}-latest.json`);
  if (!fs.existsSync(infraPath)) {
    throw new Error(`Infrastructure not found. Run deployImplementations.ts first!`);
  }
  const infra = JSON.parse(fs.readFileSync(infraPath, 'utf8'));

  // Get contracts
  const token = await ethers.getContractAt('Token', tokenAddress, registrar);
  const identityRegistry = await token.identityRegistry();
  const ir = await ethers.getContractAt('IdentityRegistry', identityRegistry, registrar);

  console.log('    ✅ Token loaded:', tokenAddress);
  console.log('    ✅ Identity Registry:', identityRegistry);
  console.log('    ✅ Claim Issuer:', claimIssuerData.claimIssuer.address);

  // Verify registrar is an agent
  const isAgent = await ir.isAgent(registrar.address);
  if (!isAgent) {
    throw new Error(`Registrar ${registrar.address} is not an agent of the Identity Registry. Add as agent first!`);
  }
  console.log('    ✅ Registrar is IR agent');

  // ========================================================================
  // STEP 2: Check if Investor Already Registered
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Checking Existing Registration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const existingIdentity = await ir.identity(investorWallet);

  if (existingIdentity !== ethers.constants.AddressZero) {
    console.log('    ⚠️  Investor already registered!');
    console.log('    Existing Identity:', existingIdentity);
    const isVerified = await ir.isVerified(investorWallet);
    console.log('    Verification Status:', isVerified ? '✅ Verified' : '❌ Not Verified');

    // Try to retrieve salt from existing registration file if available
    let existingSalt: string | undefined;
    const existingRegistrationFile = path.join(__dirname, '..', 'deployments', 'investors', `investor-${investorWallet.toLowerCase()}.json`);
    if (fs.existsSync(existingRegistrationFile)) {
      const existingData = JSON.parse(fs.readFileSync(existingRegistrationFile, 'utf8'));
      existingSalt = existingData.salt;
    }

    return {
      investorAddress: investorWallet,
      country: country,
      identityAddress: existingIdentity,
      salt: existingSalt,
      claims: [],
    };
  }

  console.log('    ℹ️  Investor not yet registered');

  // ========================================================================
  // STEP 3: Create ONCHAINID for Investor via Identity Factory
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Creating ONCHAINID via Identity Factory');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const identityFactory = await ethers.getContractAt('IIdFactory', infra.onchainId.identityFactory, registrar);
  console.log('    Identity Factory:', identityFactory.address);

  // Get infra deployer wallet - needed to create identity (must be owner of Identity Factory)
  const infraDeployer = await getInfraDeployerWallet();
  console.log('    Infra Deployer (factory owner for identity creation):', infraDeployer.address);

  // Check if identity already exists for this wallet
  let identityAddress = await identityFactory.getIdentity(investorWallet);
  console.log('    Checking for existing identity...');

  let identitySalt: string | undefined;

  if (identityAddress === ethers.constants.AddressZero) {
    // Generate unique salt for this investor (deterministic based on wallet)
    identitySalt = `investor-${investorWallet.toLowerCase()}`;
    console.log('    Salt:', identitySalt);

    // Check if salt is already taken
    const isSaltTaken = await identityFactory.isSaltTaken(identitySalt);
    if (isSaltTaken) {
      console.log('    ⚠️  Salt already taken, using timestamp-based salt');
      identitySalt = `investor-${investorWallet.toLowerCase()}-${Date.now()}`;
    }

    // Compute management key hashes (Identity uses keccak256(address) for keys)
    // Note: The wallet parameter (investorWallet) is automatically added as a management key,
    // so we only need to add additional management keys (like the registrar)
    const registrarKeyHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [registrar.address]));

    console.log('    Creating identity with management keys...');
    console.log('      Primary wallet (auto-added as management key):', investorWallet);
    console.log('      Additional management key (registrar):', registrarKeyHash);

    // Use infra deployer wallet to create identity (must be owner of Identity Factory)
    // The wallet parameter is automatically added as a management key, so we only add the registrar
    const createTx = await identityFactory.connect(infraDeployer).createIdentityWithManagementKeys(
      investorWallet, // Primary wallet (automatically becomes a management key)
      identitySalt, // Salt for CREATE2
      [registrarKeyHash], // Additional management keys (only registrar, not investor - already included)
    );

    console.log('    Transaction hash:', createTx.hash);
    console.log('    Waiting for confirmation...');
    await createTx.wait();

    // Get the created identity address
    identityAddress = await identityFactory.getIdentity(investorWallet);
    console.log('    ✅ Identity created via factory');
  } else {
    console.log('    ✅ Identity already exists:', identityAddress);
    // Try to retrieve salt from existing registration file if available
    const existingRegistrationFile = path.join(__dirname, '..', 'deployments', 'investors', `investor-${investorWallet.toLowerCase()}.json`);
    if (fs.existsSync(existingRegistrationFile)) {
      const existingData = JSON.parse(fs.readFileSync(existingRegistrationFile, 'utf8'));
      identitySalt = existingData.salt;
    }
  }

  const identity = await ethers.getContractAt('Identity', identityAddress, registrar);
  console.log('    ✅ ONCHAINID address:', identity.address);

  // ========================================================================
  // STEP 4: Add KYC Claim to Identity
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Adding KYC Claim to Identity');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const KYC_CLAIM_TOPIC = await getClaimTopic('KYC_APPROVED');
  const defaultClaimData = claimData || ethers.utils.hexlify(ethers.utils.toUtf8Bytes('KYC approved by Sumsub'));

  // Get signing key from claim issuer deployment
  if (!claimIssuerData.signingKeys || claimIssuerData.signingKeys.length === 0) {
    throw new Error('No signing keys found in claim issuer deployment!');
  }

  const signingKey = new ethers.Wallet(claimIssuerData.signingKeys[0].privateKey);
  console.log('    Using signing key:', signingKey.address);

  // Create claim signature
  const claimDataToSign = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [identity.address, KYC_CLAIM_TOPIC, defaultClaimData]),
  );

  const signature = await signingKey.signMessage(ethers.utils.arrayify(claimDataToSign));
  console.log('    ✅ Claim signed');

  // Add claim to identity
  // Note: This requires the identity to allow the registrar to add claims
  // Or we need to use investor's wallet to add the claim
  console.log('    Adding claim to identity...');

  try {
    // Try to add claim directly (if registrar has permission)
    const claimIssuerContract = await ethers.getContractAt('ClaimIssuer', claimIssuerData.claimIssuer.address, registrar);
    const addClaimTx = await identity
      .connect(registrar)
      .addClaim(KYC_CLAIM_TOPIC, ClaimScheme.ECDSA, claimIssuerContract.address, signature, defaultClaimData, '');
    await addClaimTx.wait();
    console.log('    ✅ Claim added to identity');
  } catch (error) {
    console.log('    ⚠️  Could not add claim directly (permission issue)');
    console.log('    ℹ️  The investor must add the claim using their wallet');
    console.log('\n    Claim details for manual addition:');
    console.log('    Topic:', KYC_CLAIM_TOPIC);
    console.log('    Issuer:', claimIssuerData.claimIssuer.address);
    console.log('    Signature:', signature);
    console.log('    Data:', defaultClaimData);
  }

  // ========================================================================
  // STEP 5: Register Identity in Identity Registry
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Registering in Identity Registry');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('    Registering identity...');
  const registerTx = await ir.connect(registrar).registerIdentity(investorWallet, identity.address, country);
  await registerTx.wait();
  console.log('    ✅ Identity registered');

  // Verify registration
  const isVerified = await ir.isVerified(investorWallet);
  console.log('    Verification Status:', isVerified ? '✅ Verified' : '⚠️  Not Verified (may need valid claims)');

  // ========================================================================
  // STEP 6: Save Registration Information
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 6: Saving Registration Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const registration: InvestorRegistration = {
    investorAddress: investorWallet,
    country: country,
    identityAddress: identity.address,
    salt: identitySalt, // Store the salt used for CREATE2 deployment
    claims: [
      {
        topic: KYC_CLAIM_TOPIC,
        data: defaultClaimData,
        signature: signature,
      },
    ],
  };

  const registrationsDir = path.join(__dirname, '..', 'deployments', 'investors');
  if (!fs.existsSync(registrationsDir)) {
    fs.mkdirSync(registrationsDir, { recursive: true });
  }

  const filename = `investor-${investorWallet.toLowerCase()}.json`;
  const filepath = path.join(registrationsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(registration, null, 2));
  console.log('    ✅ Registration saved to:', filename);

  // ========================================================================
  // REGISTRATION SUMMARY
  // ========================================================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('        REGISTRATION COMPLETE ✅');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('👤 Investor Details:');
  console.log('   Wallet Address:', registration.investorAddress);
  console.log('   ONCHAINID:', registration.identityAddress);
  console.log('   Country Code:', registration.country);
  console.log('   Verification Status:', isVerified ? '✅ Verified' : '⚠️  Not Verified');

  console.log('\n📝 Claims:');
  registration.claims.forEach((claim, i) => {
    console.log(`   Claim ${i + 1}:`);
    console.log('     Topic:', claim.topic);
    console.log('     Data:', claim.data);
  });

  console.log('\n💡 Next Steps:');
  if (isVerified) {
    console.log('   ✅ Investor can now receive and transfer tokens');
    console.log('   - Mint tokens: await token.mint(investorAddress, amount)');
    console.log('   - Check balance: await token.balanceOf(investorAddress)');
  } else {
    console.log('   ⚠️  Investor needs valid claims to be verified');
    console.log('   - Ensure claim issuer is trusted in registry');
    console.log('   - Ensure claim topics match requirements');
    console.log('   - Add claim manually if needed');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return registration;
}

// Batch registration helper
async function batchRegisterInvestors(tokenAddress: string, investors: Array<{ address: string; country: number }>): Promise<InvestorRegistration[]> {
  console.log(`\n🔄 Batch registering ${investors.length} investors...\n`);

  const results: InvestorRegistration[] = [];

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < investors.length; i++) {
    console.log(`\n[${i + 1}/${investors.length}] Processing ${investors[i].address}...`);
    try {
      const result = await registerInvestor(tokenAddress, investors[i].address, investors[i].country);
      results.push(result);
      console.log('✅ Success\n');
    } catch (error) {
      console.error('❌ Failed:', error);
      console.log('Continuing with next investor...\n');
    }
  }

  console.log(`\n✅ Batch registration complete: ${results.length}/${investors.length} successful\n`);
  return results;
}

// Main execution
async function main() {
  const tokenAddress = requireEnvVar('REGISTRATION_TARGET_TOKEN');
  const investorAddress = requireEnvVar('REGISTRATION_INVESTOR_ADDRESS');
  const countryCodeInput = requireEnvVar('REGISTRATION_INVESTOR_COUNTRY');

  const countryCode = parseInt(countryCodeInput, 10);
  if (Number.isNaN(countryCode)) {
    throw new Error(`Invalid country code: ${countryCodeInput}. Must be a valid number.`);
  }

  await registerInvestor(tokenAddress, investorAddress, countryCode);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ REGISTRATION FAILED\n');
      console.error(error);
      process.exit(1);
    });
}

export { registerInvestor, batchRegisterInvestors, InvestorRegistration };

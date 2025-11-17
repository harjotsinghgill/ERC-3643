import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import loadEnv, { ensureHexPrefix, requireEnvVar, requireEnvVarOneOf, getInvestorWallet, getEnvVar } from './utils/env';
import { KeyPurpose, KeyType, ClaimScheme } from './utils/constants';

loadEnv();

async function addClaimToInvestor(investorPK: string, identityAddress: string, claimIssuerAddress: string, signingKeyPrivateKey: string) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        ADD CLAIM TO INVESTOR');
  console.log('═══════════════════════════════════════════════════════════\n');

  const investor = new ethers.Wallet(ensureHexPrefix(investorPK), ethers.provider);
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  console.log('📋 Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Investor:', investor.address);
  console.log('   Identity:', identityAddress);
  console.log('   Claim Issuer:', claimIssuerAddress, '\n');

  // Get signing wallet
  const signingWallet = new ethers.Wallet(signingKeyPrivateKey, ethers.provider);
  console.log('   Signing Key:', signingWallet.address);

  // Claim details
  const KYC_CLAIM_TOPIC = ethers.utils.id('KYC_APPROVED');
  const claimData = ethers.utils.hexlify(ethers.utils.toUtf8Bytes('KYC approved by Sumsub'));

  console.log('   Claim Topic:', KYC_CLAIM_TOPIC);
  console.log('   Claim Data:', claimData, '\n');

  // ========================================================================
  // STEP 1: Sign the Claim
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Signing Claim');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const claimDataToSign = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [identityAddress, KYC_CLAIM_TOPIC, claimData]),
  );

  const signature = await signingWallet.signMessage(ethers.utils.arrayify(claimDataToSign));
  console.log('   ✅ Claim signed');
  console.log('   Signature:', signature, '\n');

  // ========================================================================
  // STEP 2: Verify Signing Key is Authorized
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Verifying Signing Key Authorization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const claimIssuer = await ethers.getContractAt('ClaimIssuer', claimIssuerAddress);
  const keyHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [signingWallet.address]));

  const hasClaimPurpose = await claimIssuer.keyHasPurpose(keyHash, KeyPurpose.CLAIM);
  console.log('   Signing key has CLAIM purpose:', hasClaimPurpose ? '✅' : '❌');

  if (!hasClaimPurpose) {
    console.error('\n❌ ERROR: Signing key is not authorized in ClaimIssuer!');
    console.error(`   Run: await claimIssuer.addKey(keyHash, ${KeyPurpose.CLAIM}, ${KeyType.ECDSA})`);
    console.error(`   Key Hash: ${keyHash}`);
    return;
  }

  // ========================================================================
  // STEP 3: Add Claim to Identity
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Adding Claim to Identity');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const identity = await ethers.getContractAt('Identity', identityAddress);

  // Check if investor has permission to add claims
  console.log('   Checking permissions...');
  const investorKeyHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [investor.address]));

  try {
    const hasManagementKey = await identity.keyHasPurpose(investorKeyHash, KeyPurpose.MANAGEMENT);
    console.log('   Investor has MANAGEMENT key:', hasManagementKey ? '✅' : '❌');

    if (!hasManagementKey) {
      console.log('\n   ⚠️  Investor does not have permission to add claims');
      console.log('   💡 The investor must add the claim themselves using their wallet\n');
      console.log('   📋 Claim details for manual addition:');
      console.log('   {');
      console.log(`     topic: "${KYC_CLAIM_TOPIC}",`);
      console.log(`     scheme: ${ClaimScheme.ECDSA}, // ECDSA`);
      console.log(`     issuer: "${claimIssuerAddress}",`);
      console.log(`     signature: "${signature}",`);
      console.log(`     data: "${claimData}",`);
      console.log('     uri: ""');
      console.log('   }');
      console.log('');
      console.log('   📝 JavaScript code for investor:');
      console.log(
        `   await identity.addClaim(${KYC_CLAIM_TOPIC}, ${ClaimScheme.ECDSA}, "${claimIssuerAddress}", "${signature}", "${claimData}", "")`,
      );
      console.log('');
      return;
    }

    console.log('   Adding claim as investor...');
    const tx = await identity.connect(investor).addClaim(
      // ← Use investor wallet!
      KYC_CLAIM_TOPIC,
      ClaimScheme.ECDSA,
      claimIssuerAddress,
      signature,
      claimData,
      '', // No URI
    );

    console.log('   Transaction hash:', tx.hash);
    console.log('   Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('   ✅ Claim added! Block:', receipt.blockNumber);

    // ========================================================================
    // STEP 4: Verify Claim Was Added
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: Verifying Claim');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const claimIds = await identity.getClaimIdsByTopic(KYC_CLAIM_TOPIC);
    console.log('   Claims with this topic:', claimIds.length);

    if (claimIds.length > 0) {
      const claim = await identity.getClaim(claimIds[claimIds.length - 1]);
      console.log('   Latest claim:');
      console.log('     Topic:', claim.topic);
      console.log('     Issuer:', claim.issuer);
      console.log('     Scheme:', claim.scheme);
      console.log('   ✅ Claim verified on-chain');
    }

    console.log('\n✅ SUCCESS! Claim added to investor identity');
    console.log('💡 Now check if investor is verified in Identity Registry\n');
  } catch (error) {
    console.error('\n❌ Failed to add claim:', (error as Error).message);
    console.error('   Check if investor has MANAGEMENT key on the identity');
  }
}

async function main() {
  const networkName = requireEnvVar('TARGET_NETWORK');
  const deploymentsDir = path.join(__dirname, '..', 'deployments');

  // Get investor wallet from role-based resolver
  const investorPKResult = requireEnvVarOneOf(
    ['INVESTOR_PRIVATE_KEY', 'INVESTOR_PRIVATE_KEY_1'],
    'Missing investor private key. Set INVESTOR_PRIVATE_KEY or INVESTOR_PRIVATE_KEY_1',
  );
  const investorPKRaw = investorPKResult.value;
  const investorWallet = await getInvestorWallet(investorPKResult.name);

  // Get investor address from env or wallet
  const investorAddressEnv = getEnvVar('ADD_CLAIM_INVESTOR_ADDRESS');
  const investorAddress = (investorAddressEnv || investorWallet.address).toLowerCase();

  // Get identity address from env or investor file
  const investorFile = path.join(deploymentsDir, 'investors', `investor-${investorAddress}.json`);
  let identityAddress = getEnvVar('ADD_CLAIM_IDENTITY_ADDRESS');

  if (fs.existsSync(investorFile)) {
    const investorData = JSON.parse(fs.readFileSync(investorFile, 'utf8'));
    identityAddress = identityAddress || investorData.identityAddress;
  }

  if (!identityAddress) {
    throw new Error('Unable to determine investor identity address. Set ADD_CLAIM_IDENTITY_ADDRESS or ensure investor is registered.');
  }

  // Load claim issuer deployment (for signer + metadata)
  const claimIssuerFile = path.join(deploymentsDir, `claim-issuer-${networkName}-latest.json`);

  if (!fs.existsSync(claimIssuerFile)) {
    throw new Error(`Claim issuer not found: ${claimIssuerFile}. Run deployClaimIssuer.ts first.`);
  }

  const claimIssuerData = JSON.parse(fs.readFileSync(claimIssuerFile, 'utf8'));

  const signingKeyResult = requireEnvVarOneOf(
    ['CLAIM_ISSUER_SIGNER_PRIVATE_KEY', 'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_1', 'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_2'],
    'Missing claim issuer signing key. Set CLAIM_ISSUER_SIGNER_PRIVATE_KEY (or numbered variant).',
  );
  const signingKeyPK = signingKeyResult.value;

  await addClaimToInvestor(ensureHexPrefix(investorPKRaw), identityAddress, claimIssuerData.claimIssuer.address, ensureHexPrefix(signingKeyPK));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ FAILED\n');
      console.error(error);
      process.exit(1);
    });
}

export default addClaimToInvestor;

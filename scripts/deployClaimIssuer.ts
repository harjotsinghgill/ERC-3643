import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import loadEnv, { requireEnvVar, getClaimIssuerOwnerWallet, ensureHexPrefix, requireEnvVarOneOf } from './utils/env';
import { KeyPurpose, KeyType } from './utils/constants';

loadEnv();

interface ClaimIssuerDeployment {
  network: string;
  timestamp: number;
  deployer: string;
  claimIssuer: {
    address: string;
    owner: string;
  };
  signingKeys: Array<{
    address: string;
    privateKey: string;
    keyHash: string;
    purpose: number;
    keyType: number;
  }>;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        CLAIM ISSUER DEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const deployer = await getClaimIssuerOwnerWallet();
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  console.log('📋 Deployment Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Deployer:', deployer.address);
  console.log('   Balance:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH\n');

  // Initialize deployment object
  const deployment: ClaimIssuerDeployment = {
    network: networkName,
    timestamp: Date.now(),
    deployer: deployer.address,
    claimIssuer: {
      address: '',
      owner: '',
    },
    signingKeys: [],
  };

  // ========================================================================
  // STEP 1: Deploy ClaimIssuer Contract
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Deploying ClaimIssuer Contract');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Deploying ClaimIssuer with owner:', deployer.address);
  const ClaimIssuer = await ethers.getContractFactory('ClaimIssuer');
  const claimIssuer = await ClaimIssuer.deploy(deployer.address);
  await claimIssuer.deployed();

  deployment.claimIssuer.address = claimIssuer.address;
  deployment.claimIssuer.owner = deployer.address;

  console.log('    ✅ ClaimIssuer deployed at:', claimIssuer.address);

  // ========================================================================
  // STEP 2: Load and Add Signing Keys from Environment Variables
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Loading and Adding Signing Keys');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('⚠️  IMPORTANT: These keys will be used to sign KYC claims');
  console.log('    Keys are loaded from environment variables.\n');

  // Load signing keys from environment variables
  // Support multiple keys via numbered variants: CLAIM_ISSUER_SIGNER_PRIVATE_KEY_1, _2, etc.
  const signingKeyEnvVars = [
    'CLAIM_ISSUER_SIGNER_PRIVATE_KEY',
    'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_1',
    'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_2',
    'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_3',
    'CLAIM_ISSUER_SIGNER_PRIVATE_KEY_4',
  ];

  const signingKeyResults: Array<{ name: string; value: string }> = signingKeyEnvVars
    .map((envVar) => {
      try {
        return requireEnvVarOneOf([envVar], '');
      } catch {
        return null;
      }
    })
    .filter((result): result is { name: string; value: string } => result !== null);

  if (signingKeyResults.length === 0) {
    throw new Error(`Missing signing keys. Set at least one of: ${signingKeyEnvVars.join(', ')}`);
  }

  console.log(`   Found ${signingKeyResults.length} signing key(s) in environment\n`);

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < signingKeyResults.length; i++) {
    const keyResult = signingKeyResults[i];
    console.log(`${i + 1}/${signingKeyResults.length} Loading signing key #${i + 1} from ${keyResult.name}...`);

    // Create wallet from private key
    const signingKey = new ethers.Wallet(ensureHexPrefix(keyResult.value), ethers.provider);

    // Create key hash (how ONCHAINID identifies keys)
    const keyHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address'], [signingKey.address]));

    // Add key to ClaimIssuer
    // Purpose: CLAIM (used for signing claims)
    // KeyType: ECDSA (standard Ethereum key)
    // Connect to deployer wallet (owner of ClaimIssuer) to add keys
    const tx = await claimIssuer.connect(deployer).addKey(keyHash, KeyPurpose.CLAIM, KeyType.ECDSA);
    await tx.wait();

    deployment.signingKeys.push({
      address: signingKey.address,
      privateKey: signingKey.privateKey, // Store for reference (already in env)
      keyHash: keyHash,
      purpose: KeyPurpose.CLAIM,
      keyType: KeyType.ECDSA,
    });

    console.log(`    ✅ Key #${i + 1} added`);
    console.log(`       Address: ${signingKey.address}`);
    console.log(`       KeyHash: ${keyHash}`);
    console.log(`       Source: ${keyResult.name}`);
  }

  // ========================================================================
  // STEP 3: Verify Key Registration
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Verifying Key Registration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < deployment.signingKeys.length; i++) {
    const key = deployment.signingKeys[i];
    const keyExists = await claimIssuer.keyHasPurpose(key.keyHash, KeyPurpose.CLAIM);
    console.log(`    Key #${i + 1}: ${keyExists ? '✅ Verified' : '❌ Failed'}`);
  }

  // ========================================================================
  // STEP 4: Save Deployment Information
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Saving Deployment Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save full deployment with private keys (SECURE THIS FILE!)
  const filename = `claim-issuer-${networkName}-${deployment.timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Full deployment (with keys) saved to:', filename);

  // Save latest
  const latestPath = path.join(deploymentsDir, `claim-issuer-${networkName}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Latest deployment updated');

  // Save public info only (safe to share)
  const publicDeployment = {
    network: deployment.network,
    timestamp: deployment.timestamp,
    claimIssuer: deployment.claimIssuer,
    signingKeyAddresses: deployment.signingKeys.map((k) => ({
      address: k.address,
      keyHash: k.keyHash,
    })),
  };

  const publicPath = path.join(deploymentsDir, `claim-issuer-${networkName}-public.json`);
  fs.writeFileSync(publicPath, JSON.stringify(publicDeployment, null, 2));
  console.log('    ✅ Public deployment info saved to:', `claim-issuer-${networkName}-public.json`);

  // Update infrastructure deployment to include claim issuer
  const infraPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  if (fs.existsSync(infraPath)) {
    const infra = JSON.parse(fs.readFileSync(infraPath, 'utf8'));
    infra.claimIssuer = deployment.claimIssuer.address;
    fs.writeFileSync(infraPath, JSON.stringify(infra, null, 2));
    console.log('    ✅ Infrastructure deployment updated with claim issuer');
  }

  // ========================================================================
  // DEPLOYMENT SUMMARY
  // ========================================================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('        DEPLOYMENT COMPLETE ✅');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('🔐 Claim Issuer:');
  console.log('   Contract Address:', deployment.claimIssuer.address);
  console.log('   Owner:', deployment.claimIssuer.owner);
  console.log('   Signing Keys:', deployment.signingKeys.length);

  console.log('\n🔑 Signing Keys:');
  deployment.signingKeys.forEach((key, i) => {
    console.log(`\n   Key #${i + 1}:`);
    console.log(`     Address: ${key.address}`);
    console.log(`     KeyHash: ${key.keyHash}`);
    console.log(`     ⚠️  Private keys stored in environment variables`);
  });

  console.log('\n💾 Files saved:');
  console.log(`   ${filename} (PRIVATE - contains keys)`);
  console.log(`   claim-issuer-${networkName}-latest.json (PRIVATE)`);
  console.log(`   claim-issuer-${networkName}-public.json (safe to share)`);

  console.log('\n⚠️  SECURITY WARNINGS:');
  console.log('   1. NEVER commit private keys to git');
  console.log('   2. Store private keys in secure key management system');
  console.log('   3. Use environment variables (already configured)');
  console.log('   4. Consider key rotation policies');
  console.log('   5. Backup keys securely in multiple locations');

  console.log('\n📝 NEXT STEPS:');
  console.log('   1. Ensure signing key private keys are set in environment variables');
  console.log('   2. Configure your backend to use these keys from env vars');
  console.log('   3. Deploy your first token (Script 3: deployToken.ts)');
  console.log('   4. Set up Sumsub webhook integration');

  console.log('\n💡 Backend Integration:');
  console.log('   - Use signing keys to sign claims after KYC approval');
  console.log('   - Claim format: keccak256(abi.encode(identity, topic, data))');
  console.log('   - Add signed claims to user ONCHAINIDs');

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ DEPLOYMENT FAILED\n');
    console.error(error);
    process.exit(1);
  });

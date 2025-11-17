/* eslint-disable no-continue */
/* eslint-disable no-plusplus */
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import loadEnv, { requireEnvVar } from './utils/env';

loadEnv();

/**
 * Verify and fix investor verification status
 * This script helps diagnose why an investor is not verified
 */
async function verifyInvestor(tokenAddress: string, investorAddress: string) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        INVESTOR VERIFICATION DIAGNOSTICS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const [viewer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  console.log('📋 Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Inspector:', viewer.address);
  console.log('   Token:', tokenAddress);
  console.log('   Investor:', investorAddress, '\n');

  // Load contracts
  const token = await ethers.getContractAt('Token', tokenAddress);
  const identityRegistryAddress = await token.identityRegistry();
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', identityRegistryAddress);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Check Identity Registry Registration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check if investor is registered
  const investorIdentity = await identityRegistry.identity(investorAddress);
  console.log('   Investor Identity:', investorIdentity);

  if (investorIdentity === ethers.constants.AddressZero) {
    console.log('   ❌ Investor NOT registered in Identity Registry');
    console.log('\n   🔧 FIX: Run registerInvestor script');
    return;
  }
  console.log('   ✅ Investor is registered');

  const investorCountry = await identityRegistry.investorCountry(investorAddress);
  console.log('   Country Code:', investorCountry.toString());

  // Check verification status
  const isVerified = await identityRegistry.isVerified(investorAddress);
  console.log('   Verification Status:', isVerified ? '✅ VERIFIED' : '❌ NOT VERIFIED');

  if (isVerified) {
    console.log('\n✅ Investor is fully verified and can trade tokens!\n');
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Check Required Claims');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const claimTopicsRegistryAddress = await identityRegistry.topicsRegistry();
  const claimTopicsRegistry = await ethers.getContractAt('ClaimTopicsRegistry', claimTopicsRegistryAddress);

  const requiredTopics = await claimTopicsRegistry.getClaimTopics();
  console.log('   Required Claim Topics:', requiredTopics.length);
  requiredTopics.forEach((topic, i) => {
    console.log(`     ${i + 1}. ${topic}`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Check Trusted Issuers');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const trustedIssuersRegistryAddress = await identityRegistry.issuersRegistry();
  const trustedIssuersRegistry = await ethers.getContractAt('TrustedIssuersRegistry', trustedIssuersRegistryAddress);

  const trustedIssuers = await trustedIssuersRegistry.getTrustedIssuers();
  console.log('   Trusted Issuers:', trustedIssuers.length);
  for (let i = 0; i < trustedIssuers.length; i++) {
    const issuer = trustedIssuers[i];
    const issuerClaims = await trustedIssuersRegistry.getTrustedIssuerClaimTopics(issuer);
    console.log(`     ${i + 1}. ${issuer}`);
    console.log(
      `        Can issue topics:`,
      issuerClaims.map((t) => t.toString()),
    );
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Check Identity Claims');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const identity = await ethers.getContractAt('Identity', investorIdentity);

  console.log('   Checking claims on identity...\n');

  for (let i = 0; i < requiredTopics.length; i++) {
    const topic = requiredTopics[i];
    console.log(`   Required Topic ${i + 1}: ${topic}`);

    try {
      const claimIds = await identity.getClaimIdsByTopic(topic);
      console.log(`     Claims found: ${claimIds.length}`);

      if (claimIds.length === 0) {
        console.log(`     ❌ NO CLAIMS for this topic`);
        console.log(`     🔧 FIX: Need to add claim for topic ${topic}`);
        continue;
      }

      for (let j = 0; j < claimIds.length; j++) {
        const claimId = claimIds[j];
        const claim = await identity.getClaim(claimId);

        console.log(`\n     Claim ${j + 1}:`);
        console.log(`       Topic: ${claim.topic}`);
        console.log(`       Scheme: ${claim.scheme}`);
        console.log(`       Issuer: ${claim.issuer}`);
        console.log(`       Signature: ${claim.signature.substring(0, 20)}...`);
        console.log(`       Data: ${claim.data}`);

        // Check if issuer is trusted
        const isTrustedIssuer = trustedIssuers.some((issuer) => issuer.toLowerCase() === claim.issuer.toLowerCase());
        console.log(`       Issuer Trusted: ${isTrustedIssuer ? '✅' : '❌'}`);

        if (!isTrustedIssuer) {
          console.log(`       🔧 FIX: Issuer ${claim.issuer} is not in trusted issuers list`);
        }

        // Check if issuer can issue this topic
        if (isTrustedIssuer) {
          const issuerTopics = await trustedIssuersRegistry.getTrustedIssuerClaimTopics(claim.issuer);
          const canIssueTopic = issuerTopics.some((t) => t.toString() === claim.topic.toString());
          console.log(`       Can Issue This Topic: ${canIssueTopic ? '✅' : '❌'}`);

          if (!canIssueTopic) {
            console.log(`       🔧 FIX: Issuer not authorized for topic ${claim.topic}`);
          }
        }

        // Verify claim signature
        try {
          const claimIssuer = await ethers.getContractAt('ClaimIssuer', claim.issuer);
          const claimDataHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [investorIdentity, claim.topic, claim.data]),
          );

          console.log('   Claim Data Hash:', claimDataHash);

          const isValid = await claimIssuer.isClaimValid(identity.address, claim.topic, claim.signature, claim.data);
          console.log(`       Signature Valid: ${isValid ? '✅' : '❌'}`);

          if (!isValid) {
            console.log(`       🔧 FIX: Claim signature is invalid, need to re-issue`);
          }
        } catch (error) {
          console.log(`       ⚠️  Could not verify signature: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      console.log(`     ❌ Error checking claims: ${(error as Error).message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Diagnosis Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (isVerified) {
    console.log('✅ Status: VERIFIED - No issues found\n');
  } else {
    console.log('❌ Status: NOT VERIFIED\n');
    console.log('Common Issues:');
    console.log('  1. Missing claims on ONCHAINID');
    console.log('  2. Claim issuer not in trusted issuers list');
    console.log('  3. Claim signature invalid');
    console.log('  4. Claim topic not in required topics');
    console.log('  5. Issuer not authorized for claim topic\n');

    console.log('🔧 How to Fix:');
    console.log('  1. Load claim issuer deployment:');
    console.log('     const claimIssuerData = require("../deployments/claim-issuer-...");');
    console.log('  2. Sign new claim with correct key');
    console.log('  3. Add claim to identity: identity.addClaim(...)');
    console.log('  4. Verify issuer is trusted: trustedIssuersRegistry.addTrustedIssuer(...)');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

async function main() {
  const tokenSymbol = requireEnvVar('VERIFY_TARGET_TOKEN');
  const investorAddress = requireEnvVar('VERIFY_INVESTOR_ADDRESS');

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  const tokenFile = path.join(deploymentsDir, `token-${tokenSymbol}-latest.json`);
  if (!fs.existsSync(tokenFile)) {
    throw new Error(`Token deployment not found: ${tokenFile}. Run deployToken.ts first!`);
  }

  const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  await verifyInvestor(tokenData.token.address, investorAddress);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ VERIFICATION FAILED\n');
      console.error(error);
      process.exit(1);
    });
}

export default verifyInvestor;

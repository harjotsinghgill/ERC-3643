/* eslint-disable no-underscore-dangle */
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import loadEnv, {
  requireEnvVar,
  getTokenIssuerWallet,
  getRegistrationAgentWallet,
  getTokenOperationsAgentWallet,
  getInfraDeployerWallet,
} from './utils/env';
import { getClaimTopic } from './utils/constants';

loadEnv();

interface TokenDeploymentParams {
  // Required token details
  name: string;
  symbol: string;
  decimals: number;
  owner: Awaited<ReturnType<typeof getTokenIssuerWallet>>;

  // Optional: existing identity registry storage (for shared registry)
  existingIRS?: string;

  // Optional: existing ONCHAINID (if token already has one)
  existingONCHAINID?: string;

  // Optional: additional agents (defaults to role-based agents from env)
  irAgents?: string[]; // Can register investors
  tokenAgents?: string[]; // Can mint/burn/pause

  // Optional: compliance modules (defaults to basic compliance only)
  complianceModules?: string[];
  complianceSettings?: string[]; // Encoded function calls for module setup

  // Optional: claim configuration (defaults to ['KYC_APPROVED'])
  claimTopics?: string[];
}

interface TokenDeployment {
  network: string;
  timestamp: number;
  deployer: string;
  salt: string;
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    owner: string;
    onchainId: string;
  };
  suite: {
    identityRegistry: string;
    identityRegistryStorage: string;
    trustedIssuersRegistry: string;
    claimTopicsRegistry: string;
    compliance: string;
  };
  configuration: {
    claimTopics: string[];
    claimIssuers: string[];
    irAgents: string[];
    tokenAgents: string[];
    complianceModules: string[];
  };
}

async function loadInfrastructure(networkName: string) {
  const infraPath = path.join(__dirname, '..', 'deployments', `${networkName}-latest.json`);
  if (!fs.existsSync(infraPath)) {
    throw new Error(`Infrastructure deployment not found: ${infraPath}\nRun deployImplementations.ts first!`);
  }
  return JSON.parse(fs.readFileSync(infraPath, 'utf8'));
}

async function loadClaimIssuer(networkName: string) {
  const claimIssuerPath = path.join(__dirname, '..', 'deployments', `claim-issuer-${networkName}-latest.json`);
  if (!fs.existsSync(claimIssuerPath)) {
    throw new Error(`Claim issuer deployment not found: ${claimIssuerPath}\nRun deployClaimIssuer.ts first!`);
  }
  return JSON.parse(fs.readFileSync(claimIssuerPath, 'utf8'));
}

async function deployToken(params: TokenDeploymentParams): Promise<TokenDeployment> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        TOKEN SUITE DEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Use provided owner wallet
  const ownerWallet = params.owner;
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  // Load role-based agents from environment variables (used as defaults)
  const registrationAgent = await getRegistrationAgentWallet();
  const tokenOperationsAgent = await getTokenOperationsAgentWallet();

  console.log('📋 Deployment Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Owner/Deployer:', ownerWallet.address);
  console.log('   Balance:', ethers.utils.formatEther(await ownerWallet.getBalance()), 'ETH');
  console.log('   Token:', params.name, `(${params.symbol})`);
  console.log('   Decimals:', params.decimals);
  if (params.existingIRS) {
    console.log('   Using existing IRS:', params.existingIRS);
  }
  if (params.existingONCHAINID) {
    console.log('   Using existing ONCHAINID:', params.existingONCHAINID);
  }
  console.log('   Registration Agent:', registrationAgent.address);
  console.log('   Token Operations Agent:', tokenOperationsAgent.address, '\n');

  // ========================================================================
  // STEP 1: Load Infrastructure
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Loading Infrastructure');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const infra = await loadInfrastructure(networkName);
  const claimIssuerData = await loadClaimIssuer(networkName);

  console.log('    ✅ Factory:', infra.trex.factory);
  console.log('    ✅ Claim Issuer:', claimIssuerData.claimIssuer.address);

  // ========================================================================
  // STEP 2: Prepare Deployment Parameters
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Preparing Deployment Parameters');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Determine agents: use provided or default to role-based agents
  const irAgents = params.irAgents && params.irAgents.length > 0 ? params.irAgents : [registrationAgent.address];
  const tokenAgents = params.tokenAgents && params.tokenAgents.length > 0 ? params.tokenAgents : [tokenOperationsAgent.address];

  // Determine claim topics: use provided or default to KYC_APPROVED
  const defaultClaimTopic = await getClaimTopic('KYC_APPROVED');
  const claimTopics = params.claimTopics && params.claimTopics.length > 0 ? params.claimTopics : [defaultClaimTopic];

  console.log('    Claim Topics:', claimTopics.length);
  claimTopics.forEach((topic, i) => {
    console.log(`      ${i + 1}. ${topic}`);
  });

  console.log(`    Identity Registry Agents: ${irAgents.length}`);
  irAgents.forEach((agent, i) => {
    console.log(`      ${i + 1}. ${agent}`);
  });
  console.log(`    Token Agents: ${tokenAgents.length}`);
  tokenAgents.forEach((agent, i) => {
    console.log(`      ${i + 1}. ${agent}`);
  });

  if (params.complianceModules && params.complianceModules.length > 0) {
    console.log(`    Compliance Modules: ${params.complianceModules.length}`);
  }

  // Build token details struct - only include optional params if provided
  const tokenDetails = {
    owner: ownerWallet.address,
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    irs: params.existingIRS || ethers.constants.AddressZero,
    ONCHAINID: params.existingONCHAINID || ethers.constants.AddressZero,
    irAgents,
    tokenAgents,
    // Always include compliance modules/settings (empty array if not provided)
    complianceModules: params.complianceModules || [],
    complianceSettings: params.complianceSettings || [],
  };

  // Claim details struct
  const claimDetails = {
    claimTopics: claimTopics,
    issuers: [claimIssuerData.claimIssuer.address],
    issuerClaims: [claimTopics], // Issuer can issue all claim topics
  };

  // ========================================================================
  // STEP 3: Deploy Token Suite via Factory
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Deploying Token Suite via TREXFactory');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Generate unique salt for CREATE2 deployment
  const salt = `${params.symbol}-${Date.now()}`;
  console.log('    Salt:', salt);

  const factory = await ethers.getContractAt('TREXFactory', infra.trex.factory);

  // Get factory owner (infra deployer) - only factory owner can call deployTREXSuite
  const factoryOwner = await getInfraDeployerWallet();

  console.log('    Deploying suite...');
  console.log('    Factory Owner (deployer):', factoryOwner.address);
  console.log('    Token Owner (will own deployed contracts):', ownerWallet.address);
  // Connect to factory owner (must be owner of TREXFactory)
  // Note: tokenDetails.owner is set to token issuer, who will receive ownership of deployed contracts
  const tx = await factory.connect(factoryOwner).deployTREXSuite(salt, tokenDetails, claimDetails);
  console.log('    Transaction sent:', tx.hash);

  console.log('    Waiting for confirmation...');
  const receipt = await tx.wait();
  console.log('    ✅ Confirmed in block:', receipt.blockNumber);

  // Extract addresses from event
  const event = receipt.events?.find((e) => e.event === 'TREXSuiteDeployed');

  if (!event || !event.args) {
    throw new Error('TREXSuiteDeployed event not found in transaction receipt');
  }

  const deployment: TokenDeployment = {
    network: networkName,
    timestamp: Date.now(),
    deployer: ownerWallet.address,
    salt,
    token: {
      address: event.args[0],
      name: params.name,
      symbol: params.symbol,
      decimals: params.decimals,
      owner: ownerWallet.address,
      onchainId: '', // Will be fetched
    },
    suite: {
      identityRegistry: event.args[1],
      identityRegistryStorage: event.args[2],
      trustedIssuersRegistry: event.args[3],
      claimTopicsRegistry: event.args[4],
      compliance: event.args[5],
    },
    configuration: {
      claimTopics: claimTopics,
      claimIssuers: [claimIssuerData.claimIssuer.address],
      irAgents: irAgents,
      tokenAgents: tokenAgents,
      complianceModules: params.complianceModules || [],
    },
  };

  // ========================================================================
  // STEP 4: Fetch Token ONCHAINID
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Fetching Token Details');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const token = await ethers.getContractAt('Token', deployment.token.address);
  const tokenOID = await token.onchainID();
  deployment.token.onchainId = tokenOID;

  console.log('    ✅ Token ONCHAINID:', tokenOID);

  // ========================================================================
  // STEP 5: Save Deployment Information
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Saving Deployment Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save timestamped deployment
  const filename = `token-${params.symbol}-${deployment.timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Deployment saved to:', filename);

  // Save as latest for this token
  const latestPath = path.join(deploymentsDir, `token-${params.symbol}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Latest deployment updated');

  // ========================================================================
  // DEPLOYMENT SUMMARY
  // ========================================================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('        DEPLOYMENT COMPLETE ✅');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('🪙 Token Details:');
  console.log('   Name:', deployment.token.name);
  console.log('   Symbol:', deployment.token.symbol);
  console.log('   Decimals:', deployment.token.decimals);
  console.log('   Address:', deployment.token.address);
  console.log('   ONCHAINID:', deployment.token.onchainId);
  console.log('   Owner:', deployment.token.owner);

  console.log('\n📋 Registry Contracts:');
  console.log('   Identity Registry:', deployment.suite.identityRegistry);
  console.log('   Identity Registry Storage:', deployment.suite.identityRegistryStorage);
  console.log('   Trusted Issuers Registry:', deployment.suite.trustedIssuersRegistry);
  console.log('   Claim Topics Registry:', deployment.suite.claimTopicsRegistry);
  console.log('   Compliance:', deployment.suite.compliance);

  console.log('\n⚙️  Configuration:');
  console.log('   Claim Topics:', deployment.configuration.claimTopics.length);
  console.log('   Claim Issuers:', deployment.configuration.claimIssuers.length);
  console.log('   IR Agents:', deployment.configuration.irAgents.length);
  console.log('   Token Agents:', deployment.configuration.tokenAgents.length);
  console.log('   Compliance Modules:', deployment.configuration.complianceModules.length);

  console.log('\n📝 NEXT STEPS:');
  console.log('   1. Verify contracts on block explorer');
  console.log('   2. Set up investor onboarding flow');
  console.log('   3. Configure Sumsub webhook to issue claims');
  console.log('   4. Register first investors in Identity Registry');
  console.log('   5. Mint initial token supply (if needed)');

  console.log('\n💡 Useful Commands:');
  console.log(`   Get token info: await token.name()`);
  console.log(`   Check if paused: await token.paused()`);
  console.log(`   Add agent: await token.addAgent(address)`);
  console.log(`   Mint tokens: await token.mint(address, amount)`);

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return deployment;
}

// Main execution
async function main() {
  // Load token details from environment variables
  const tokenName = requireEnvVar('TOKEN_NAME');
  const tokenSymbol = requireEnvVar('TOKEN_SYMBOL');
  const tokenDecimalsInput = requireEnvVar('TOKEN_DECIMALS');

  const tokenDecimals = parseInt(tokenDecimalsInput, 10);
  if (Number.isNaN(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error(`Invalid token decimals: ${tokenDecimalsInput}. Must be a number between 0 and 18.`);
  }

  const owner = await getTokenIssuerWallet();
  const investorRegistrationAgent = await getRegistrationAgentWallet();
  const tokenOperationsAgent = await getTokenOperationsAgentWallet();

  const deployment = await deployToken({
    name: tokenName,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    owner,
    irAgents: [investorRegistrationAgent.address],
    tokenAgents: [tokenOperationsAgent.address],
  });

  console.log('Token deployed at:', deployment.token.address);
}

// Allow script to be imported or run directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ DEPLOYMENT FAILED\n');
      console.error(error);
      process.exit(1);
    });
}

export { deployToken, TokenDeploymentParams, TokenDeployment };

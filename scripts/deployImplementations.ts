import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import OnchainID from '@onchain-id/solidity';
import loadEnv, { requireEnvVar, getInfraDeployerWallet } from './utils/env';

loadEnv();

interface DeploymentAddresses {
  network: string;
  timestamp: number;
  deployer: string;

  // Core implementations
  implementations: {
    token: string;
    claimTopicsRegistry: string;
    trustedIssuersRegistry: string;
    identityRegistryStorage: string;
    identityRegistry: string;
    modularCompliance: string;
  };

  // ONCHAINID infrastructure
  onchainId: {
    identityImplementation: string;
    identityImplementationAuthority: string;
    identityFactory: string;
  };

  // TREX infrastructure
  trex: {
    implementationAuthority: string;
    factory: string;
  };

  // Version info
  version: {
    major: number;
    minor: number;
    patch: number;
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        ERC-3643 INFRASTRUCTURE DEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const deployer = await getInfraDeployerWallet();
  const network = await ethers.provider.getNetwork();
  const networkName = requireEnvVar('TARGET_NETWORK');

  console.log('📋 Deployment Configuration:');
  console.log('   Network:', networkName, `(Chain ID: ${network.chainId})`);
  console.log('   Deployer:', deployer.address);
  console.log('   Balance:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH\n');

  // Initialize deployment object
  const deployment: DeploymentAddresses = {
    network: networkName,
    timestamp: Date.now(),
    deployer: deployer.address,
    implementations: {
      token: '',
      claimTopicsRegistry: '',
      trustedIssuersRegistry: '',
      identityRegistryStorage: '',
      identityRegistry: '',
      modularCompliance: '',
    },
    onchainId: {
      identityImplementation: '',
      identityImplementationAuthority: '',
      identityFactory: '',
    },
    trex: {
      implementationAuthority: '',
      factory: '',
    },
    version: {
      major: 0,
      minor: 1,
      patch: 0,
    },
  };

  // ========================================================================
  // STEP 1: Deploy Core Implementation Contracts
  // ========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: Deploying Core Implementation Contracts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('1/6 Deploying Token implementation...');
  const Token = await ethers.getContractFactory('Token');
  const tokenImpl = await Token.deploy();
  await tokenImpl.deployed();
  deployment.implementations.token = tokenImpl.address;
  console.log('    ✅ Token:', tokenImpl.address);

  console.log('2/6 Deploying ClaimTopicsRegistry implementation...');
  const ClaimTopicsRegistry = await ethers.getContractFactory('ClaimTopicsRegistry');
  const ctrImpl = await ClaimTopicsRegistry.deploy();
  await ctrImpl.deployed();
  deployment.implementations.claimTopicsRegistry = ctrImpl.address;
  console.log('    ✅ ClaimTopicsRegistry:', ctrImpl.address);

  console.log('3/6 Deploying TrustedIssuersRegistry implementation...');
  const TrustedIssuersRegistry = await ethers.getContractFactory('TrustedIssuersRegistry');
  const tirImpl = await TrustedIssuersRegistry.deploy();
  await tirImpl.deployed();
  deployment.implementations.trustedIssuersRegistry = tirImpl.address;
  console.log('    ✅ TrustedIssuersRegistry:', tirImpl.address);

  console.log('4/6 Deploying IdentityRegistryStorage implementation...');
  const IdentityRegistryStorage = await ethers.getContractFactory('IdentityRegistryStorage');
  const irsImpl = await IdentityRegistryStorage.deploy();
  await irsImpl.deployed();
  deployment.implementations.identityRegistryStorage = irsImpl.address;
  console.log('    ✅ IdentityRegistryStorage:', irsImpl.address);

  console.log('5/6 Deploying IdentityRegistry implementation...');
  const IdentityRegistry = await ethers.getContractFactory('IdentityRegistry');
  const irImpl = await IdentityRegistry.deploy();
  await irImpl.deployed();
  deployment.implementations.identityRegistry = irImpl.address;
  console.log('    ✅ IdentityRegistry:', irImpl.address);

  console.log('6/6 Deploying ModularCompliance implementation...');
  const ModularCompliance = await ethers.getContractFactory('ModularCompliance');
  const mcImpl = await ModularCompliance.deploy();
  await mcImpl.deployed();
  deployment.implementations.modularCompliance = mcImpl.address;
  console.log('    ✅ ModularCompliance:', mcImpl.address);

  // ========================================================================
  // STEP 2: Deploy ONCHAINID Infrastructure
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: Deploying ONCHAINID Infrastructure');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('1/3 Deploying Identity implementation...');
  const IdentityImplementation = new ethers.ContractFactory(OnchainID.contracts.Identity.abi, OnchainID.contracts.Identity.bytecode, deployer);
  const identityImpl = await IdentityImplementation.deploy(deployer.address, true);
  await identityImpl.deployed();
  deployment.onchainId.identityImplementation = identityImpl.address;
  console.log('    ✅ Identity Implementation:', identityImpl.address);

  console.log('2/3 Deploying Identity ImplementationAuthority...');
  const IdImplementationAuthority = new ethers.ContractFactory(
    OnchainID.contracts.ImplementationAuthority.abi,
    OnchainID.contracts.ImplementationAuthority.bytecode,
    deployer,
  );
  const idImplAuthority = await IdImplementationAuthority.deploy(identityImpl.address);
  await idImplAuthority.deployed();
  deployment.onchainId.identityImplementationAuthority = idImplAuthority.address;
  console.log('    ✅ Identity ImplementationAuthority:', idImplAuthority.address);

  console.log('3/3 Deploying Identity Factory...');
  const IdFactory = new ethers.ContractFactory(OnchainID.contracts.Factory.abi, OnchainID.contracts.Factory.bytecode, deployer);
  const idFactory = await IdFactory.deploy(idImplAuthority.address);
  await idFactory.deployed();
  deployment.onchainId.identityFactory = idFactory.address;
  console.log('    ✅ Identity Factory:', idFactory.address);

  // ========================================================================
  // STEP 3: Deploy TREX Implementation Authority
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: Deploying TREX Implementation Authority');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Deploying TREXImplementationAuthority...');
  const TREXImplementationAuthority = await ethers.getContractFactory('TREXImplementationAuthority');
  const trexIA = await TREXImplementationAuthority.deploy(true, ethers.constants.AddressZero, ethers.constants.AddressZero);
  await trexIA.deployed();
  deployment.trex.implementationAuthority = trexIA.address;
  console.log('    ✅ TREXImplementationAuthority:', trexIA.address);

  console.log('\nRegistering implementation contracts...');
  const versionStruct = {
    major: deployment.version.major,
    minor: deployment.version.minor,
    patch: deployment.version.patch,
  };

  const contractsStruct = {
    tokenImplementation: deployment.implementations.token,
    ctrImplementation: deployment.implementations.claimTopicsRegistry,
    irImplementation: deployment.implementations.identityRegistry,
    irsImplementation: deployment.implementations.identityRegistryStorage,
    tirImplementation: deployment.implementations.trustedIssuersRegistry,
    mcImplementation: deployment.implementations.modularCompliance,
  };

  // Connect to deployer (must be owner of TREXImplementationAuthority)
  const tx = await trexIA.connect(deployer).addAndUseTREXVersion(versionStruct, contractsStruct);
  await tx.wait();
  console.log(`    ✅ Implementations registered (v${deployment.version.major}.${deployment.version.minor}.${deployment.version.patch})`);

  // Verify registration
  const registeredTokenImpl = await trexIA.getTokenImplementation();
  console.log(
    '    🔍 Verification: Token implementation matches:',
    registeredTokenImpl.toLowerCase() === deployment.implementations.token.toLowerCase(),
  );

  // ========================================================================
  // STEP 4: Deploy TREX Factory
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: Deploying TREX Factory');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Deploying TREXFactory...');
  const TREXFactory = await ethers.getContractFactory('TREXFactory');
  const trexFactory = await TREXFactory.deploy(deployment.trex.implementationAuthority, deployment.onchainId.identityFactory);
  await trexFactory.deployed();
  deployment.trex.factory = trexFactory.address;
  console.log('    ✅ TREXFactory:', trexFactory.address);

  // ========================================================================
  // STEP 5: Link Factory to Identity Factory
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: Linking Factory to Identity Factory');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Adding TREXFactory as token factory in Identity Factory...');
  // Connect to deployer (must have permission to add token factories)
  const addFactoryTx = await idFactory.connect(deployer).addTokenFactory(trexFactory.address);
  await addFactoryTx.wait();
  console.log('    ✅ Factory linked successfully');

  // ========================================================================
  // STEP 6: Save Deployment Addresses
  // ========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 6: Saving Deployment Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment info
  const filename = `${networkName}-${deployment.timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Deployment saved to:', filename);

  // Also save as latest
  const latestPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deployment, null, 2));
  console.log('    ✅ Latest deployment updated');

  // ========================================================================
  // DEPLOYMENT SUMMARY
  // ========================================================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('        DEPLOYMENT COMPLETE ✅');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📦 Core Implementations:');
  console.log('   Token:                    ', deployment.implementations.token);
  console.log('   ClaimTopicsRegistry:      ', deployment.implementations.claimTopicsRegistry);
  console.log('   TrustedIssuersRegistry:   ', deployment.implementations.trustedIssuersRegistry);
  console.log('   IdentityRegistryStorage:  ', deployment.implementations.identityRegistryStorage);
  console.log('   IdentityRegistry:         ', deployment.implementations.identityRegistry);
  console.log('   ModularCompliance:        ', deployment.implementations.modularCompliance);

  console.log('\n🆔 ONCHAINID Infrastructure:');
  console.log('   Identity Implementation:  ', deployment.onchainId.identityImplementation);
  console.log('   Implementation Authority: ', deployment.onchainId.identityImplementationAuthority);
  console.log('   Identity Factory:         ', deployment.onchainId.identityFactory);

  console.log('\n🏭 TREX Infrastructure:');
  console.log('   Implementation Authority: ', deployment.trex.implementationAuthority);
  console.log('   TREX Factory:             ', deployment.trex.factory);

  console.log('\n💾 Deployment files saved to:');
  console.log('   ', filepath);
  console.log('   ', latestPath);

  console.log('\n⚠️  IMPORTANT NEXT STEPS:');
  console.log('   1. Verify all contracts on block explorer');
  console.log('   2. Deploy claim issuer contract (Script 2)');
  console.log('   3. Deploy individual tokens using the factory');
  console.log('   4. Transfer factory ownership if needed');

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return deployment;
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ DEPLOYMENT FAILED\n');
    console.error(error);
    process.exit(1);
  });

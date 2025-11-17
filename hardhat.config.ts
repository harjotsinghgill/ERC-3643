import '@xyrusworx/hardhat-solidity-json';
import '@nomicfoundation/hardhat-toolbox';
import { HardhatUserConfig } from 'hardhat/config';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import '@nomiclabs/hardhat-solhint';
import '@primitivefi/hardhat-dodoc';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const ensureHexPrefix = (key: string) => (key.startsWith('0x') ? key : `0x${key}`);

const roleBasedAccounts = [
  process.env.INFRA_DEPLOYER_PRIVATE_KEY,
  process.env.TOKEN_ISSUER_PRIVATE_KEY,
  process.env.CLAIM_ISSUER_OWNER_PRIVATE_KEY,
  process.env.REGISTRATION_AGENT_PRIVATE_KEY,
  process.env.TOKEN_OPERATIONS_AGENT_PRIVATE_KEY,
  process.env.COMPLIANCE_MANAGER_PRIVATE_KEY,
]
  .filter((pk): pk is string => Boolean(pk && pk.trim().length > 0))
  .map((pk) => ensureHexPrefix(pk.trim()))
  .slice(0, 20); // hardhat allows up to 20 accounts by default

if (roleBasedAccounts.length === 0) {
  const fallbackKey = process.env.DEFAULT_PRIVATE_KEY || '1f36dd877bfa8a8946ed49441b7767db5cddc0d82822641335c483ba7760abb5';
  roleBasedAccounts.push(ensureHexPrefix(fallbackKey));
}

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  gasReporter: {
    enabled: true,
  },
  networks: {
    redbellyStaging: {
      url: process.env.REDBELLY_STAGING_RPC || 'https://rbn9bb267fa.staging.redbelly.network/rpc',
      accounts: roleBasedAccounts,
      chainId: 171,
    },
    redbelly_testnet: {
      url: process.env.REDBELLY_TESTNET_RPC || 'https://governors.testnet.redbelly.network',
      accounts: roleBasedAccounts,
      chainId: 153,
    },
    redbelly_mainnet: {
      url: process.env.REDBELLY_MAINNET_RPC || 'https://governors.mainnet.redbelly.network',
      accounts: roleBasedAccounts,
      chainId: 151,
    },
  },
  dodoc: {
    runOnCompile: false,
    debugMode: true,
    outputDir: './docgen',
    freshOutput: true,
  },
};

export default config;

import * as dotenv from 'dotenv';
import * as path from 'path';

let loaded = false;

export default function loadEnv() {
  if (loaded) {
    return;
  }

  const rootDir = path.resolve(__dirname, '..', '..');
  const envPath = path.join(rootDir, '.env');

  // dotenv.config() will only load if file exists and won't override existing env vars
  dotenv.config({ path: envPath });

  loaded = true;
}

const normalize = (value?: string) => (value && value.trim().length > 0 ? value.trim() : undefined);

export const ensureHexPrefix = (key: string) => (key.startsWith('0x') ? key : `0x${key}`);

export function getEnvVar(name: string): string | undefined {
  loadEnv();
  return normalize(process.env[name]);
}

export function requireEnvVar(name: string, message?: string): string {
  const value = getEnvVar(name);
  if (!value) {
    throw new Error(message || `Missing required environment variable: ${name}`);
  }
  return value;
}

export function requireEnvVarOneOf(names: string[], message?: string): { name: string; value: string } {
  // eslint-disable-next-line no-restricted-syntax
  for (const name of names) {
    const value = getEnvVar(name);
    if (value) {
      return { name, value };
    }
  }
  throw new Error(message || `Missing required environment variable. Set one of: ${names.join(', ')}`);
}

// Role-based wallet resolvers
export async function getInfraDeployerWallet() {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar('INFRA_DEPLOYER_PRIVATE_KEY'));
  return new ethers.Wallet(privateKey, ethers.provider);
}

export async function getTokenIssuerWallet() {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar('TOKEN_ISSUER_PRIVATE_KEY'));
  return new ethers.Wallet(privateKey, ethers.provider);
}

export async function getClaimIssuerOwnerWallet() {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar('CLAIM_ISSUER_OWNER_PRIVATE_KEY'));
  return new ethers.Wallet(privateKey, ethers.provider);
}

export async function getRegistrationAgentWallet() {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar('REGISTRATION_AGENT_PRIVATE_KEY'));
  return new ethers.Wallet(privateKey, ethers.provider);
}

export async function getTokenOperationsAgentWallet() {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar('TOKEN_OPERATIONS_AGENT_PRIVATE_KEY'));
  return new ethers.Wallet(privateKey, ethers.provider);
}

export async function getInvestorWallet(investorKeyName: string = 'INVESTOR_PRIVATE_KEY_1') {
  const { ethers } = await import('hardhat');
  const privateKey = ensureHexPrefix(requireEnvVar(investorKeyName, `Missing ${investorKeyName}. Set investor private key.`));
  return new ethers.Wallet(privateKey, ethers.provider);
}

/* eslint-disable no-shadow */
/* eslint-disable no-unused-vars */

/**
 * Constants for ERC-3643 and ONCHAINID operations
 * Based on ONCHAINID specification and ERC-3643 standard
 */

/**
 * Key Purpose enum values for ONCHAINID Identity keys
 * These define what a key can be used for
 */

export enum KeyPurpose {
  /** Key can manage the identity (add/remove keys, add claims, etc.) */
  MANAGEMENT = 1,
  /** Key can execute transactions on behalf of the identity */
  EXECUTION = 2,
  /** Key can sign claims (used by ClaimIssuer) */
  CLAIM = 3,
}

/**
 * Key Type enum values for ONCHAINID Identity keys
 * These define the cryptographic scheme used by the key
 */
export enum KeyType {
  /** Elliptic Curve Digital Signature Algorithm (standard Ethereum key) */
  ECDSA = 1,
}

/**
 * Claim Scheme enum values for ONCHAINID claims
 * These define how a claim should be verified or processed
 */

export enum ClaimScheme {
  /** Elliptic Curve Digital Signature Algorithm (standard Ethereum signature) */
  ECDSA = 1,
}

/**
 * Common claim topics (keccak256 hashes of claim topic strings)
 */
export const ClaimTopics = {
  /** KYC approval claim topic */
  KYC_APPROVED: '0x0fcfa10035044c80f593fee52cb5bdc69fc4ee08fd995d1366281d153155f807', // keccak256("KYC_APPROVED")
} as const;

/**
 * Helper function to generate claim topic from string
 * @param topicString - The claim topic string (e.g., "KYC_APPROVED")
 * @returns The keccak256 hash of the topic string
 */
export async function getClaimTopic(topicString: string): Promise<string> {
  // Dynamic import to avoid circular dependencies
  const { ethers } = await import('hardhat');
  return ethers.utils.id(topicString);
}

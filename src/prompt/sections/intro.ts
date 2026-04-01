/**
 * Intro section — Agent identity framing.
 *
 * Mirrors codenano's getSimpleIntroSection().
 * Sets the agent's role and base behavioral constraints.
 */

import type { OutputStyleConfig } from '../types.js'

/**
 * Build the intro section.
 *
 * @param identity — Custom identity string (e.g. "You are a coding assistant")
 * @param outputStyle — Optional output style that overrides default role description
 */
export function getIntroSection(identity: string, outputStyle?: OutputStyleConfig | null): string {
  const roleDescription = outputStyle
    ? 'according to your "Output Style" below, which describes how you should respond to user queries.'
    : 'with software engineering tasks. Use the instructions below and the tools available to you to assist the user.'

  return `${identity}

You are an interactive agent that helps users ${roleDescription}

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes.
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.`
}

/** Default identity for SDK agents */
export const DEFAULT_IDENTITY = `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

/** codenano CLI identity */
export const CLAUDE_CODE_IDENTITY = `You are codenano, Anthropic's official CLI for Claude.`

/** codenano running within Agent SDK */
export const CLAUDE_CODE_SDK_IDENTITY = `You are codenano, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`

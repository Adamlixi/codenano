/**
 * Environment section — Runtime environment context.
 *
 * Mirrors codenano's computeSimpleEnvInfo().
 * Injects working directory, platform, model info, etc.
 */

import type { EnvironmentInfo } from '../types.js'
import { prependBullets } from '../utils.js'

/**
 * Build the environment info section.
 *
 * @param model — Model ID being used
 * @param env — Environment details to include
 */
export function getEnvironmentSection(model: string, env?: EnvironmentInfo): string {
  const rawItems: (string | string[] | null)[] = [
    env?.cwd ? `Primary working directory: ${env.cwd}` : null,
    env?.isGitRepo !== undefined ? [`Is a git repository: ${env.isGitRepo}`] : null,
    env?.additionalWorkingDirectories && env.additionalWorkingDirectories.length > 0
      ? `Additional working directories:`
      : null,
    env?.additionalWorkingDirectories && env.additionalWorkingDirectories.length > 0
      ? env.additionalWorkingDirectories
      : null,
    env?.platform ? `Platform: ${env.platform}` : null,
    env?.shell ? `Shell: ${env.shell}` : null,
    env?.osVersion ? `OS Version: ${env.osVersion}` : null,
    `You are powered by the model ${model}.`,
    env?.knowledgeCutoff ? `Assistant knowledge cutoff is ${env.knowledgeCutoff}.` : null,
  ]
  const items = rawItems.filter((item): item is string | string[] => item !== null)

  return [
    '# Environment',
    'You have been invoked in the following environment: ',
    ...prependBullets(items),
  ].join('\n')
}

/**
 * Auto-detect environment info from the current process.
 * Useful as a default when no explicit env is provided.
 */
export function detectEnvironment(): EnvironmentInfo {
  const shell = process.env.SHELL || 'unknown'
  const shellName = shell.includes('zsh') ? 'zsh' : shell.includes('bash') ? 'bash' : shell

  return {
    cwd: process.cwd(),
    platform: process.platform,
    shell: shellName,
    osVersion: `${process.platform} ${process.version}`,
  }
}

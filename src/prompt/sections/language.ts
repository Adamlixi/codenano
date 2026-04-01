/**
 * Language section — Response language preference.
 *
 * Mirrors codenano's getLanguageSection().
 */

/**
 * Build the language preference section.
 *
 * @param language — Language name (e.g. "Chinese", "Japanese", "English")
 * @returns Section string or null if no preference
 */
export function getLanguageSection(
  language: string | undefined,
): string | null {
  if (!language) return null

  return `# Language
Always respond in ${language}. Use ${language} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.`
}

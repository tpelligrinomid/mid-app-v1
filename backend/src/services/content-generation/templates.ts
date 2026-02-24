/**
 * Content Generation — Template Resolution
 *
 * Resolves {{variable}} and {{step:key}} placeholders in prompt text.
 */

/**
 * Resolve all {{variable}} placeholders in a string.
 * Handles both regular variables and {{step:key}} references.
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
  stepOutputs: Record<string, string>
): string {
  return template.replace(/\{\{(\w[\w:.]*)\}\}/g, (_match, key: string) => {
    // Step output reference: {{step:draft}}
    if (key.startsWith('step:')) {
      const stepKey = key.slice(5);
      return stepOutputs[stepKey] || `[Step "${stepKey}" output not available]`;
    }

    // Regular variable: {{company_name}}
    return variables[key] ?? '';
  });
}

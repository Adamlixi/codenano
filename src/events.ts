/**
 * events.ts — Stream event transformation
 *
 * Converts internal model stream events into public SDK StreamEvents.
 */

import type { StreamEvent } from './types.js'
import type { ModelStreamEvent } from './provider.js'

/** Convert a ModelStreamEvent to a public StreamEvent (or null if not relevant) */
export function toPublicEvent(event: ModelStreamEvent, turnNumber: number): StreamEvent | null {
  switch (event.type) {
    case 'text_delta':
      return { type: 'text', text: event.text }

    case 'thinking_delta':
      return { type: 'thinking', thinking: event.thinking }

    case 'tool_use_start':
      return {
        type: 'tool_use',
        toolName: event.name,
        toolUseId: event.id,
        input: undefined,
      }

    case 'message_start':
      return { type: 'turn_start', turnNumber }

    case 'message_delta':
      if (event.stopReason) {
        return {
          type: 'turn_end',
          stopReason: event.stopReason,
          turnNumber,
        }
      }
      return null

    // These are internal and don't map to public events
    case 'input_json_delta':
    case 'content_block_stop':
    case 'message_complete':
      return null

    default:
      return null
  }
}

import { BaseMessage } from "@langchain/core/messages";
import {
  Annotation,
  Messages,
  messagesStateReducer,
} from "@langchain/langgraph";

/**
 * Main graph state.
 */
export const GraphAnnotation = Annotation.Root({
  /**
   * The messages in the conversation.
   */
  messages: Annotation<BaseMessage[], Messages>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

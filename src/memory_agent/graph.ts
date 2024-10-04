// Main graph
import {
  LangGraphRunnableConfig,
  START,
  StateGraph,
  END,
} from "@langchain/langgraph";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { initChatModel } from "langchain/chat_models/universal";
import { initializeTools } from "./tools.js";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
} from "./configuration.js";
import { GraphAnnotation } from "./state.js";
import { getStoreFromConfigOrThrow, splitModelAndProvider } from "./utils.js";

const llm = await initChatModel();

async function callModel(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  let formatted =
    memories
      ?.map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
      ?.join("\n") || "";
  if (formatted) {
    formatted = `\n<memories>\n${formatted}\n</memories>`;
  }

  const sys = configurable.systemPrompt
    .replace("{user_info}", formatted)
    .replace("{time}", new Date().toISOString());

  const tools = initializeTools(config);
  const boundLLM = llm.bind({
    tools: tools,
    tool_choice: "auto",
  });

  const result = await boundLLM.invoke(
    [{ role: "system", content: sys }, ...state.messages],
    {
      configurable: splitModelAndProvider(configurable.model),
    },
  );

  return { messages: [result] };
}

async function storeMemory(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  const tools = initializeTools(config);
  const upsertMemoryTool = tools[0];

  const savedMemories = await Promise.all(
    toolCalls.map(async (tc) => {
      return await upsertMemoryTool.invoke(tc);
    }),
  );

  return { messages: savedMemories };
}

function routeMessage(
  state: typeof GraphAnnotation.State,
): "store_memory" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls?.length) {
    return "store_memory";
  }
  return END;
}

// Create the graph + all nodes
export const builder = new StateGraph(
  {
    stateSchema: GraphAnnotation,
  },
  ConfigurationAnnotation,
)
  .addNode("call_model", callModel)
  .addNode("store_memory", storeMemory)
  .addEdge(START, "call_model")
  .addConditionalEdges("call_model", routeMessage, {
    store_memory: "store_memory",
    [END]: END,
  })
  .addEdge("store_memory", "call_model");

export const graph = builder.compile();
graph.name = "MemoryAgent";

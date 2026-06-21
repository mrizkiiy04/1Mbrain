/**
 * Parse conversation + ingestion data from benchmark predict outputs.
 *
 * Locomo:      debug txt files (conv_X_ingestion.txt) + locomo10.json dataset
 * LongMemEval: per-question predict JSONs with ingestion.operations[]
 * BEAM:        debug txt files (beam_{size}_{conv}_ingestion.txt)
 */

import fs from "fs";
import path from "path";

// --- Types ---

export interface Message {
  speaker: string;
  text: string;
  dia_id?: string; // e.g. "D1:3" from locomo, "T123" from BEAM
}

export interface Chunk {
  chunk_idx: number;
  messages: Message[];
  extracted_memories: string[];
}

export interface Session {
  session_id: string;
  session_idx: number;
  date: string;
  epoch?: number;
  contains_answer_for: string[]; // question IDs this session has evidence for
  chunks: Chunk[];
  event_summary?: Record<string, string[]>; // speaker -> events
}

export interface ConversationQuestion {
  question_id: string;
  question: string;
  answer: string;
  category: number;
  category_name: string;
  evidence: string[];
  evidence_sessions: number[];
}

export interface ConversationData {
  conversation_idx: number;
  speakers: { a: string; b: string };
  user_id: string;
  num_sessions: number;
  questions: ConversationQuestion[];
  sessions: Session[];
}

export interface ConversationsResult {
  eval_type: "locomo" | "longmemeval" | "beam";
  capabilities: {
    has_answer_sessions: boolean;
    has_ingestion_debug: boolean;
    has_ground_truth_evidence: boolean;
  };
  conversations: ConversationData[];
}

// --- Debug txt parser (shared by LOCOMO and BEAM) ---

const CATEGORY_NAMES: Record<number, string> = {
  1: "multi-hop",
  2: "temporal",
  3: "open-domain",
  4: "single-hop",
  5: "adversarial",
};

function parseEvidence(
  ref: string,
): { session: number; turn: number } | null {
  const m = ref.match(/^D(\d+):(\d+)$/);
  if (!m) return null;
  return { session: parseInt(m[1]), turn: parseInt(m[2]) };
}

/**
 * Parse a conv_X_ingestion.txt debug file into structured chunks.
 */
function parseDebugTxt(content: string): {
  sessions: {
    session_id: string;
    date: string;
    epoch: number;
    chunks: Chunk[];
  }[];
} {
  const sessions: {
    session_id: string;
    date: string;
    epoch: number;
    chunks: Chunk[];
  }[] = [];
  let currentSession: {
    session_id: string;
    date: string;
    epoch: number;
    chunks: Chunk[];
  } | null = null;
  let currentChunk: Chunk | null = null;
  let collectingMemories = false;

  for (const line of content.split("\n")) {
    // Session header
    const sessionMatch = line.match(
      /^SESSION:\s+(\S+)\s+\|\s+Date:\s+(.+?)\s+\|\s+Epoch:\s+(\d+)/,
    );
    if (sessionMatch) {
      if (currentChunk && currentSession) currentSession.chunks.push(currentChunk);
      if (currentSession) sessions.push(currentSession);
      currentSession = {
        session_id: sessionMatch[1],
        date: sessionMatch[2],
        epoch: parseInt(sessionMatch[3]),
        chunks: [],
      };
      currentChunk = null;
      collectingMemories = false;
      continue;
    }

    // Chunk header: --- Chunk 0 (8 messages) ---
    const chunkMsgMatch = line.match(
      /^--- Chunk (\d+) \((\d+) messages?\) ---$/,
    );
    if (chunkMsgMatch) {
      if (currentChunk && currentSession) currentSession.chunks.push(currentChunk);
      currentChunk = {
        chunk_idx: parseInt(chunkMsgMatch[1]),
        messages: [],
        extracted_memories: [],
      };
      collectingMemories = false;
      continue;
    }

    // Extracted memories header
    const chunkMemMatch = line.match(
      /^--- Chunk \d+ \(extracted memories\) ---$/,
    );
    if (chunkMemMatch) {
      collectingMemories = true;
      continue;
    }

    // Message line
    if (
      !collectingMemories &&
      currentChunk &&
      line.match(/^\s+(?:user|assistant):\s/)
    ) {
      const msgMatch = line.match(
        /^\s+(user|assistant):\s+(\S+?):\s+(.+)$/,
      );
      if (msgMatch) {
        currentChunk.messages.push({
          speaker: msgMatch[2],
          text: msgMatch[3],
        });
      } else {
        const simpleMatch = line.match(/^\s+(user|assistant):\s+(.+)$/);
        if (simpleMatch) {
          currentChunk.messages.push({
            speaker: simpleMatch[1] === "user" ? "User" : "Assistant",
            text: simpleMatch[2],
          });
        }
      }
      continue;
    }

    // Memory line
    if (collectingMemories && currentChunk) {
      const trimmed = line.trim();
      if (trimmed === "(no memories extracted)") {
        collectingMemories = false;
        continue;
      }
      if (
        trimmed.startsWith("***") ||
        trimmed.startsWith("\u2550") ||
        trimmed.startsWith("\u2500")
      ) {
        continue;
      }
      if (
        trimmed.startsWith("ADD:") ||
        trimmed.startsWith("UPDATE:") ||
        trimmed.startsWith("DELETE:")
      ) {
        currentChunk.extracted_memories.push(trimmed);
      } else if (
        trimmed.startsWith("[ADD]") ||
        trimmed.startsWith("[UPDATE]") ||
        trimmed.startsWith("[DELETE]") ||
        trimmed.startsWith("[NOOP]")
      ) {
        currentChunk.extracted_memories.push(trimmed);
      } else if (trimmed.startsWith("- ")) {
        currentChunk.extracted_memories.push(trimmed.slice(2));
      } else if (
        trimmed &&
        !trimmed.startsWith("---") &&
        !trimmed.startsWith("SESSION")
      ) {
        currentChunk.extracted_memories.push(trimmed);
      }
    }
  }

  if (currentChunk && currentSession) currentSession.chunks.push(currentChunk);
  if (currentSession) sessions.push(currentSession);

  // Deduplicate sessions produced by restarts
  const mergedMap = new Map<
    string,
    { session_id: string; date: string; epoch: number; chunks: Chunk[] }
  >();
  for (const s of sessions) {
    const existing = mergedMap.get(s.session_id);
    if (!existing) {
      mergedMap.set(s.session_id, s);
    } else {
      for (const chunk of s.chunks) {
        const existingChunk = existing.chunks.find(
          (c) => c.chunk_idx === chunk.chunk_idx,
        );
        if (!existingChunk) {
          existing.chunks.push(chunk);
        } else {
          const existingScore =
            existingChunk.messages.length +
            existingChunk.extracted_memories.filter(
              (m) => m.replace(/^\s*\[?\w+\]?\s*$/, "").length > 0,
            ).length;
          const newScore =
            chunk.messages.length +
            chunk.extracted_memories.filter(
              (m) => m.replace(/^\s*\[?\w+\]?\s*$/, "").length > 0,
            ).length;
          if (newScore > existingScore) {
            const idx = existing.chunks.indexOf(existingChunk);
            existing.chunks[idx] = chunk;
          }
        }
      }
      existing.chunks.sort((a, b) => a.chunk_idx - b.chunk_idx);
    }
  }

  // Filter out empty extracted memories
  const merged = [...mergedMap.values()];
  for (const s of merged) {
    for (const chunk of s.chunks) {
      chunk.extracted_memories = chunk.extracted_memories.filter((m) => {
        const textOnly = m
          .replace(/^\s*\[?(ADD|UPDATE|DELETE|NOOP)\]?[:\s]*/i, "")
          .trim();
        return textOnly.length > 0;
      });
    }
  }

  return { sessions: merged };
}

// --- Locomo Parser ---

export function loadLocomoConversations(
  predictDir: string,
  datasetPath?: string,
): ConversationsResult {
  // Load dataset for ground truth
  let dataset: Record<string, unknown>[] = [];
  const dsPath =
    datasetPath ??
    path.resolve(process.cwd(), "datasets", "locomo", "locomo10.json");
  if (fs.existsSync(dsPath)) {
    dataset = JSON.parse(fs.readFileSync(dsPath, "utf-8"));
  }

  const conversations: ConversationData[] = [];
  const hasDebug = fs.existsSync(path.join(predictDir, "debug"));

  for (let convIdx = 0; convIdx < 10; convIdx++) {
    const ingestionFile = path.join(
      predictDir,
      `_ingestion_${convIdx}.json`,
    );
    if (!fs.existsSync(ingestionFile)) continue;

    const ingestion = JSON.parse(fs.readFileSync(ingestionFile, "utf-8"));
    const dsConv = dataset[convIdx];
    const convData = dsConv?.conversation as
      | Record<string, unknown>
      | undefined;
    const qaList = (dsConv?.qa ?? []) as Record<string, unknown>[];
    const eventSummary = (dsConv?.event_summary ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    // Parse questions + evidence
    const questions: ConversationQuestion[] = [];
    const evidenceSessionMap = new Map<number, string[]>();

    if (qaList.length > 0) {
      for (let qi = 0; qi < qaList.length; qi++) {
        const qa = qaList[qi];
        if (typeof qa !== "object" || qa === null) continue;
        const qid = `conv${convIdx}_q${qi}`;
        const evidenceRefs = (qa.evidence ?? []) as string[];
        const evidenceSessions = new Set<number>();

        for (const ref of evidenceRefs) {
          const parsed = parseEvidence(ref);
          if (parsed) {
            evidenceSessions.add(parsed.session);
            const existing = evidenceSessionMap.get(parsed.session) ?? [];
            existing.push(qid);
            evidenceSessionMap.set(parsed.session, existing);
          }
        }

        questions.push({
          question_id: qid,
          question: qa.question as string,
          answer: qa.answer as string,
          category: qa.category as number,
          category_name:
            CATEGORY_NAMES[qa.category as number] ?? "unknown",
          evidence: evidenceRefs,
          evidence_sessions: [...evidenceSessions],
        });
      }
    } else {
      // Fallback: build questions from predict files
      const predictFiles = fs
        .readdirSync(predictDir)
        .filter(
          (f) =>
            f.startsWith(`conv${convIdx}_q`) && f.endsWith(".json"),
        )
        .sort((a, b) => {
          const na = parseInt(
            a.replace(`conv${convIdx}_q`, "").replace(".json", ""),
          );
          const nb = parseInt(
            b.replace(`conv${convIdx}_q`, "").replace(".json", ""),
          );
          return na - nb;
        });

      for (const pf of predictFiles) {
        try {
          const predict = JSON.parse(
            fs.readFileSync(path.join(predictDir, pf), "utf-8"),
          );
          const qid = predict.question_id as string;
          const evidenceRefs = (predict.evidence ?? []) as string[];
          const evidenceSessions = new Set<number>();

          for (const ref of evidenceRefs) {
            const parsed = parseEvidence(ref);
            if (parsed) {
              evidenceSessions.add(parsed.session);
              const existing =
                evidenceSessionMap.get(parsed.session) ?? [];
              existing.push(qid);
              evidenceSessionMap.set(parsed.session, existing);
            }
          }

          questions.push({
            question_id: qid,
            question: predict.question as string,
            answer: predict.answer as string,
            category: predict.category as number,
            category_name:
              CATEGORY_NAMES[predict.category as number] ??
              (predict.category_name as string) ??
              "unknown",
            evidence: evidenceRefs,
            evidence_sessions: [...evidenceSessions],
          });
        } catch {
          /* skip malformed */
        }
      }
    }

    // Parse debug txt or build sessions from dataset
    let sessions: Session[] = [];

    if (hasDebug) {
      const debugFile = path.join(
        predictDir,
        "debug",
        `conv_${convIdx}_ingestion.txt`,
      );
      if (fs.existsSync(debugFile)) {
        const parsed = parseDebugTxt(
          fs.readFileSync(debugFile, "utf-8"),
        );
        sessions = parsed.sessions.map((s) => {
          const sIdx = parseInt(
            s.session_id.replace("session_", ""),
          );
          return {
            ...s,
            session_idx: sIdx,
            contains_answer_for:
              evidenceSessionMap.get(sIdx) ?? [],
            event_summary: extractEventSummary(
              eventSummary,
              sIdx,
            ),
          };
        });

        // Enrich debug messages with dia_id from dataset
        if (convData) {
          for (const session of sessions) {
            const sessionKey = `session_${session.session_idx}`;
            const dsMsgs = (convData[sessionKey] ?? []) as Record<
              string,
              unknown
            >[];
            let msgIdx = 0;
            for (const chunk of session.chunks) {
              for (const msg of chunk.messages) {
                if (msgIdx < dsMsgs.length) {
                  msg.dia_id = dsMsgs[msgIdx].dia_id as
                    | string
                    | undefined;
                }
                msgIdx++;
              }
            }
          }
        } else {
          for (const session of sessions) {
            let turn = 1;
            for (const chunk of session.chunks) {
              for (const msg of chunk.messages) {
                msg.dia_id = `D${session.session_idx}:${turn}`;
                turn++;
              }
            }
          }
        }
      }
    }

    // If no debug files, build sessions from dataset
    if (sessions.length === 0 && convData) {
      const sessionKeys = Object.keys(convData)
        .filter(
          (k) =>
            k.match(/^session_\d+$/) && !k.includes("date"),
        )
        .sort((a, b) => {
          const na = parseInt(a.replace("session_", ""));
          const nb = parseInt(b.replace("session_", ""));
          return na - nb;
        });

      for (const sk of sessionKeys) {
        const sIdx = parseInt(sk.replace("session_", ""));
        const msgs = (convData[sk] ?? []) as Record<
          string,
          unknown
        >[];
        const dateKey = `${sk}_date_time`;
        const date = (convData[dateKey] as string) ?? "";

        sessions.push({
          session_id: sk,
          session_idx: sIdx,
          date,
          contains_answer_for:
            evidenceSessionMap.get(sIdx) ?? [],
          chunks: [
            {
              chunk_idx: 0,
              messages: msgs.map((m) => ({
                speaker: m.speaker as string,
                text: m.text as string,
                dia_id: m.dia_id as string | undefined,
              })),
              extracted_memories: [],
            },
          ],
          event_summary: extractEventSummary(
            eventSummary,
            sIdx,
          ),
        });
      }
    }

    conversations.push({
      conversation_idx: convIdx,
      speakers: {
        a: ingestion.speaker_a ?? "Speaker A",
        b: ingestion.speaker_b ?? "Speaker B",
      },
      user_id: ingestion.user_id ?? "",
      num_sessions: ingestion.num_sessions ?? sessions.length,
      questions,
      sessions,
    });
  }

  return {
    eval_type: "locomo",
    capabilities: {
      has_answer_sessions: true,
      has_ingestion_debug: hasDebug,
      has_ground_truth_evidence:
        dataset.length > 0 ||
        conversations.some((c) =>
          c.questions.some((q) => q.evidence.length > 0),
        ),
    },
    conversations,
  };
}

function extractEventSummary(
  eventSummary: Record<string, Record<string, unknown>>,
  sessionIdx: number,
): Record<string, string[]> | undefined {
  const key = `events_session_${sessionIdx}`;
  const events = eventSummary[key];
  if (!events) return undefined;

  const result: Record<string, string[]> = {};
  for (const [speaker, evList] of Object.entries(events)) {
    if (speaker === "date") continue;
    if (Array.isArray(evList) && evList.length > 0) {
      result[speaker] = evList as string[];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// --- LongMemEval Parser ---

export function loadLongMemEvalConversations(
  predictDir: string,
): ConversationsResult {
  const files = fs
    .readdirSync(predictDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const conversations: ConversationData[] = [];

  for (const file of files) {
    const predict = JSON.parse(
      fs.readFileSync(path.join(predictDir, file), "utf-8"),
    );
    const qid = predict.question_id as string;
    const ingestion = predict.ingestion as
      | Record<string, unknown>
      | undefined;

    if (!ingestion) continue;

    const metadata = predict.metadata as
      | Record<string, unknown>
      | undefined;
    const answerSessionIds = new Set(
      (metadata?.answer_session_ids ?? []) as string[],
    );
    const ops = (ingestion.operations ?? []) as Record<string, unknown>[];

    // Group operations by session
    const sessionMap = new Map<
      string,
      { ops: Record<string, unknown>[]; idx: number; date: string }
    >();
    for (const op of ops) {
      const sid = op.session_id as string;
      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, {
          ops: [],
          idx: op.session_idx as number,
          date: op.session_date as string,
        });
      }
      sessionMap.get(sid)!.ops.push(op);
    }

    const sessions: Session[] = [];
    for (const [sid, sdata] of sessionMap) {
      const isAnswer =
        answerSessionIds.has(sid) ||
        [...answerSessionIds].some((aid) =>
          sid.includes(aid.replace("answer_", "")),
        );

      sessions.push({
        session_id: sid,
        session_idx: sdata.idx,
        date: sdata.date,
        contains_answer_for: isAnswer ? [qid] : [],
        chunks: sdata.ops.map((op, i) => {
          const actualMessages = op.messages as
            | Array<{ role: string; content: string }>
            | undefined;
          let messages: Array<{ speaker: string; text: string }>;
          if (
            actualMessages &&
            Array.isArray(actualMessages) &&
            actualMessages.length > 0
          ) {
            messages = actualMessages.map(
              (m: { role: string; content: string }) => ({
                speaker:
                  m.role === "user" ? "User" : "Assistant",
                text: m.content || "",
              }),
            );
          } else {
            messages = [
              {
                speaker: "system",
                text: `Pair ${op.pair_idx} (${op.num_messages} messages)`,
              },
            ];
          }

          const extractionResults = op.extraction_results as
            | Array<{ event: string; memory: string }>
            | undefined;
          let memoryStrings: string[];
          if (
            extractionResults &&
            Array.isArray(extractionResults) &&
            extractionResults.length > 0
          ) {
            memoryStrings = extractionResults.map(
              (m: { event: string; memory: string }) =>
                `${m.event || "ADD"}: ${m.memory || ""}`,
            );
          } else {
            const summary = op.response_summary as
              | Record<string, unknown>
              | undefined;
            const events = (summary?.events ?? {}) as Record<
              string,
              number
            >;
            memoryStrings = [];
            for (const [evType, count] of Object.entries(events)) {
              memoryStrings.push(`${evType}: ${count} memories`);
            }
          }

          return {
            chunk_idx: i,
            messages,
            extracted_memories: op.success
              ? memoryStrings
              : ["FAILED"],
          };
        }),
      });
    }

    conversations.push({
      conversation_idx: conversations.length,
      speakers: { a: "User", b: "Assistant" },
      user_id: (predict.user_id as string) ?? "",
      num_sessions:
        (ingestion.num_sessions as number) ?? sessions.length,
      questions: [
        {
          question_id: qid,
          question: predict.question as string,
          answer: predict.answer as string,
          category: 0,
          category_name:
            (predict.question_type as string) ?? "unknown",
          evidence: [],
          evidence_sessions: sessions
            .filter((s) => s.contains_answer_for.length > 0)
            .map((s) => s.session_idx),
        },
      ],
      sessions,
    });
  }

  return {
    eval_type: "longmemeval",
    capabilities: {
      has_answer_sessions: true,
      has_ingestion_debug: true,
      has_ground_truth_evidence: false,
    },
    conversations,
  };
}

// --- BEAM Parser ---

/**
 * Flatten source_chat_ids from BEAM probing questions into a flat number array.
 * source_chat_ids can be: number[], number[][], or {key: number[]} dict.
 */
function flattenSourceChatIds(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const result: number[] = [];
    for (const item of raw) {
      if (typeof item === "number") result.push(item);
      else if (Array.isArray(item))
        result.push(
          ...item.filter((n): n is number => typeof n === "number"),
        );
    }
    return result;
  }
  if (typeof raw === "object" && raw !== null) {
    const result: number[] = [];
    for (const val of Object.values(
      raw as Record<string, unknown>,
    )) {
      if (Array.isArray(val))
        result.push(
          ...val.filter((n): n is number => typeof n === "number"),
        );
      else if (typeof val === "number") result.push(val);
    }
    return result;
  }
  return [];
}

export function loadBeamConversations(
  predictDir: string,
): ConversationsResult {
  const conversations: ConversationData[] = [];
  const hasDebug = fs.existsSync(path.join(predictDir, "debug"));

  // Discover conversations from predict files: {size}_{convIdx}_q{qi}_{type}.json
  const predictFiles = fs
    .readdirSync(predictDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();

  // Group files by (chatSize, convIdx)
  const convMap = new Map<
    string,
    { chatSize: string; convIdx: number; files: string[] }
  >();
  for (const file of predictFiles) {
    const match = file.match(/^(\d+[KM])_(\d+)_q\d+_/);
    if (!match) continue;
    const key = `${match[1]}_${match[2]}`;
    if (!convMap.has(key)) {
      convMap.set(key, {
        chatSize: match[1],
        convIdx: parseInt(match[2]),
        files: [],
      });
    }
    convMap.get(key)!.files.push(file);
  }

  for (const [, conv] of convMap) {
    const { chatSize, convIdx, files } = conv;

    // Read ingestion checkpoint for metadata
    const ingestionFile = path.join(
      predictDir,
      `_ingestion_${chatSize}_${convIdx}.json`,
    );
    let ingestionMeta: Record<string, unknown> = {};
    if (fs.existsSync(ingestionFile)) {
      try {
        ingestionMeta = JSON.parse(
          fs.readFileSync(ingestionFile, "utf-8"),
        );
      } catch {
        /* skip */
      }
    }

    // Build questions from predict files
    const questions: ConversationQuestion[] = [];
    const sourceChatsMap = new Map<number, string[]>();

    for (const file of files) {
      try {
        const predict = JSON.parse(
          fs.readFileSync(path.join(predictDir, file), "utf-8"),
        );
        const qid = predict.question_id as string;
        const sourceIds = flattenSourceChatIds(
          predict.source_chat_ids,
        );

        for (const sid of sourceIds) {
          const existing = sourceChatsMap.get(sid) ?? [];
          existing.push(qid);
          sourceChatsMap.set(sid, existing);
        }

        questions.push({
          question_id: qid,
          question: predict.question as string,
          answer: ((predict.rubric as string[]) ?? []).join(" | "),
          category: 0,
          category_name:
            (predict.question_type as string) ?? "unknown",
          evidence: sourceIds.map((id) => `T${id}`),
          evidence_sessions: [],
        });
      } catch {
        /* skip malformed */
      }
    }

    // Parse debug file for sessions if available
    let sessions: Session[] = [];
    if (hasDebug) {
      const debugFile = path.join(
        predictDir,
        "debug",
        `beam_${chatSize}_${convIdx}_ingestion.txt`,
      );
      if (fs.existsSync(debugFile)) {
        const parsed = parseDebugTxt(
          fs.readFileSync(debugFile, "utf-8"),
        );

        sessions = parsed.sessions.map((s) => {
          const sIdx = parseInt(
            s.session_id
              .replace("session_", "")
              .replace("batch_", ""),
          );

          // Collect all turn IDs in this session's messages
          const sessionTurnIds = new Set<number>();
          for (const chunk of s.chunks) {
            for (const msg of chunk.messages) {
              if (msg.dia_id) {
                const tid = parseInt(msg.dia_id.replace("T", ""));
                if (!isNaN(tid)) sessionTurnIds.add(tid);
              }
            }
          }

          // Check which questions have evidence in this session
          const answersFor = new Set<string>();
          for (const tid of sessionTurnIds) {
            const qids = sourceChatsMap.get(tid);
            if (qids) {
              for (const qid of qids) answersFor.add(qid);
            }
          }

          return {
            ...s,
            session_idx: sIdx,
            contains_answer_for: [...answersFor],
          };
        });
      }
    }

    const globalConvIdx = conversations.length;
    conversations.push({
      conversation_idx: globalConvIdx,
      speakers: { a: "User", b: "Assistant" },
      user_id: (ingestionMeta.user_id as string) ?? "",
      num_sessions:
        (ingestionMeta.total_batches as number) ?? sessions.length,
      questions,
      sessions,
    });
  }

  return {
    eval_type: "beam",
    capabilities: {
      has_answer_sessions: true,
      has_ingestion_debug: hasDebug,
      has_ground_truth_evidence: true,
    },
    conversations,
  };
}

// --- Auto-detect and load ---

export function loadConversations(
  predictDir: string,
  evalType: string,
): ConversationsResult | null {
  if (!fs.existsSync(predictDir)) return null;

  if (evalType === "locomo") return loadLocomoConversations(predictDir);
  if (evalType === "longmemeval")
    return loadLongMemEvalConversations(predictDir);
  if (evalType === "beam") return loadBeamConversations(predictDir);
  return null;
}

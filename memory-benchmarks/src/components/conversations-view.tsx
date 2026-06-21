"use client";

import { useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Brain,
  HelpCircle,
  Search,
  Star,
  Loader2,
} from "lucide-react";

// ---- Types ----

interface MessageData {
  speaker: string;
  text: string;
  timestamp?: string;
  turnId?: string;
}

interface MemoryData {
  text: string;
  eventType?: string;
}

interface SessionData {
  id: string;
  messages: MessageData[];
  extractedMemories?: MemoryData[];
  isAnswerSession?: boolean;
}

interface QuestionData {
  id: string;
  question: string;
  groundTruth: string;
  evidence?: string[];
}

interface ConversationData {
  label: string;
  sessions: SessionData[];
  questions?: QuestionData[];
}

interface ConversationsViewProps {
  runId: string;
}

// ---- Data-fetching wrapper ----

export function ConversationsView({ runId }: ConversationsViewProps) {
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [evalType, setEvalType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchConversations = useCallback(() => {
    fetch(`/api/runs/${runId}/conversations`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setConversations(data.conversations ?? []);
        setEvalType(data.eval_type ?? "");
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [runId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-neutral-400" />
        <span className="ml-2 text-sm text-neutral-400">Loading conversations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="text-sm text-rose-700">{error}</p>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-neutral-400">No conversation data available.</p>
      </div>
    );
  }

  return <ConversationsViewInner conversations={conversations} evalType={evalType} />;
}

// ---- Inner Component ----

function ConversationsViewInner({
  conversations,
  evalType,
}: {
  conversations: ConversationData[];
  evalType: string;
}) {
  const [selectedConvIdx, setSelectedConvIdx] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [searchText, setSearchText] = useState("");
  const [showQuestions, setShowQuestions] = useState(false);

  const activeConv = conversations[selectedConvIdx];
  const activeSession = activeConv.sessions.find(
    (s) => s.id === selectedSessionId
  );

  const filteredSessions = activeConv.sessions.filter((session) => {
    if (!searchText) return true;
    const lower = searchText.toLowerCase();
    return (
      session.messages.some((m) => m.text.toLowerCase().includes(lower)) ||
      session.extractedMemories?.some((m) =>
        m.text.toLowerCase().includes(lower)
      )
    );
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 font-mono">
          {evalType}
        </span>
        <span className="text-[11px] text-neutral-400">
          {conversations.length} conversation{conversations.length !== 1 && "s"}
        </span>
      </div>

      {/* Conversation selector */}
      {conversations.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
            Conversation
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {conversations.map((conv, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setSelectedConvIdx(idx);
                  setSelectedSessionId(null);
                  setShowQuestions(false);
                }}
                className={clsx(
                  "px-3 py-1.5 text-[11px] font-medium rounded-md border transition-all duration-150",
                  selectedConvIdx === idx
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                    : "border-neutral-200 text-neutral-500 hover:text-neutral-700 hover:border-neutral-300"
                )}
              >
                {conv.label}
                <span className="ml-1 opacity-50">
                  ({conv.sessions.length})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Layout: session list + detail */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Session list (left panel) */}
        <div className="w-72 shrink-0 rounded-xl border border-neutral-200 bg-white overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-3 border-b border-neutral-200">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -tranneutral-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search messages..."
                className="w-full bg-neutral-50 border border-neutral-200 rounded-md pl-8 pr-3 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20"
              />
            </div>
          </div>

          {/* Questions toggle */}
          {activeConv.questions && activeConv.questions.length > 0 && (
            <button
              onClick={() => {
                setShowQuestions(!showQuestions);
                setSelectedSessionId(null);
              }}
              className={clsx(
                "flex items-center gap-2 px-3 py-2.5 text-left border-b border-neutral-200 transition-colors",
                showQuestions
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-neutral-600 hover:bg-neutral-50"
              )}
            >
              <HelpCircle size={14} strokeWidth={1.5} />
              <span className="text-xs font-medium">Questions</span>
              <span className="text-[10px] text-neutral-400 ml-auto tabular-nums">
                {activeConv.questions.length}
              </span>
            </button>
          )}

          {/* Session entries */}
          <div className="flex-1 overflow-auto">
            {filteredSessions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-400">
                No sessions match your search.
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isActive =
                  selectedSessionId === session.id && !showQuestions;
                const memoryCount = session.extractedMemories?.length ?? 0;

                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setShowQuestions(false);
                    }}
                    className={clsx(
                      "w-full flex items-start gap-2.5 px-3 py-3 text-left border-b border-neutral-100 transition-colors duration-100",
                      isActive
                        ? "bg-indigo-50/70"
                        : "hover:bg-neutral-50/70"
                    )}
                  >
                    {/* Active indicator */}
                    <div
                      className={clsx(
                        "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
                        session.isAnswerSession
                          ? "bg-emerald-500"
                          : isActive
                            ? "bg-indigo-500"
                            : "bg-neutral-300"
                      )}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={clsx(
                            "text-[13px] font-medium truncate",
                            isActive ? "text-indigo-700" : "text-neutral-900"
                          )}
                        >
                          {session.id}
                        </span>
                        {session.isAnswerSession && (
                          <Star
                            size={10}
                            className="text-emerald-500 shrink-0 fill-emerald-500"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-neutral-400 tabular-nums">
                          {session.messages.length} messages
                        </span>
                        {memoryCount > 0 && (
                          <span className="text-[11px] text-indigo-500 tabular-nums">
                            {memoryCount} memories
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Session count footer */}
          <div className="px-3 py-2 border-t border-neutral-200 bg-neutral-50">
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {filteredSessions.length}/{activeConv.sessions.length} sessions
            </span>
          </div>
        </div>

        {/* Detail panel (right) */}
        <div className="flex-1 min-w-0">
          {showQuestions && activeConv.questions ? (
            <QuestionsPanel
              questions={activeConv.questions}
              sessions={activeConv.sessions}
              onNavigateToSession={(sessionId) => {
                setSelectedSessionId(sessionId);
                setShowQuestions(false);
              }}
            />
          ) : activeSession ? (
            <SessionDetail session={activeSession} searchText={searchText} />
          ) : (
            <div className="h-full flex items-center justify-center rounded-lg border border-dashed border-neutral-200">
              <div className="text-center">
                <MessageSquare
                  size={24}
                  className="text-neutral-300 mx-auto mb-2"
                />
                <p className="text-sm text-neutral-400">
                  Select a session to view messages
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Session Detail ----

function SessionDetail({
  session,
  searchText,
}: {
  session: SessionData;
  searchText: string;
}) {
  const [showMemories, setShowMemories] = useState(true);
  const memoryCount = session.extractedMemories?.length ?? 0;

  return (
    <div className="space-y-4 animate-in">
      {/* Session header */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-neutral-900">{session.id}</h3>
        {session.isAnswerSession && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Star size={9} className="fill-emerald-500 text-emerald-500" />
            Answer session
          </span>
        )}
        <span className="text-[11px] text-neutral-400 tabular-nums ml-auto">
          {session.messages.length} messages
        </span>
      </div>

      {/* Message timeline */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-neutral-200 bg-neutral-50">
          <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
            Messages
          </span>
        </div>
        <div className="divide-y divide-neutral-100 max-h-[45vh] overflow-auto">
          {session.messages.map((msg, idx) => (
            <MessageRow key={idx} message={msg} searchText={searchText} />
          ))}
        </div>
      </div>

      {/* Extracted memories */}
      {memoryCount > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <button
            onClick={() => setShowMemories(!showMemories)}
            className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 text-left"
          >
            {showMemories ? (
              <ChevronDown size={14} className="text-neutral-400" />
            ) : (
              <ChevronRight size={14} className="text-neutral-400" />
            )}
            <Brain size={13} className="text-indigo-500" />
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Extracted Memories
            </span>
            <span className="text-[11px] text-neutral-400 tabular-nums ml-auto">
              {memoryCount}
            </span>
          </button>

          {showMemories && (
            <div className="p-3 space-y-1.5 animate-in">
              {session.extractedMemories!.map((mem, idx) => (
                <MemoryRow
                  key={idx}
                  memory={mem}
                  searchText={searchText}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {memoryCount === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-3">
          <span className="text-xs text-neutral-400">
            No memories extracted from this session.
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Message Row ----

function MessageRow({
  message,
  searchText,
}: {
  message: MessageData;
  searchText: string;
}) {
  const isUser =
    message.speaker.toLowerCase().includes("user") ||
    message.speaker.toLowerCase() === "human";

  return (
    <div className="flex gap-3 px-4 py-3 group hover:bg-neutral-50/50 transition-colors duration-100">
      {/* Speaker label */}
      <div className="shrink-0 w-24 pt-0.5">
        <span
          className={clsx(
            "text-xs font-medium",
            isUser ? "text-indigo-600" : "text-neutral-500"
          )}
        >
          {message.speaker}
        </span>
        {message.timestamp && (
          <div className="text-[10px] text-neutral-400 mt-0.5 font-mono">
            {message.timestamp}
          </div>
        )}
      </div>

      {/* Message body */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
          {highlightSearch(message.text, searchText)}
        </p>
      </div>

      {/* Turn ID */}
      {message.turnId && (
        <span className="shrink-0 text-[10px] text-neutral-300 font-mono pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {message.turnId}
        </span>
      )}
    </div>
  );
}

// ---- Memory Row ----

const EVENT_STYLES: Record<string, { badge: string; text: string }> = {
  ADD: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    text: "text-neutral-700",
  },
  UPDATE: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    text: "text-neutral-700",
  },
  DELETE: {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    text: "text-neutral-500 line-through",
  },
  NOOP: {
    badge: "bg-neutral-50 text-neutral-500 border-neutral-200",
    text: "text-neutral-400",
  },
};

function MemoryRow({
  memory,
  searchText,
}: {
  memory: MemoryData;
  searchText: string;
}) {
  const eventType = memory.eventType?.toUpperCase() ?? "";
  const styles = EVENT_STYLES[eventType];

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-50 transition-colors duration-100">
      {styles && (
        <span
          className={clsx(
            "shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
            styles.badge
          )}
        >
          {eventType}
        </span>
      )}
      <span
        className={clsx(
          "text-xs leading-relaxed",
          styles?.text ?? "text-neutral-700"
        )}
      >
        {highlightSearch(memory.text, searchText)}
      </span>
    </div>
  );
}

// ---- Questions Panel ----

function QuestionsPanel({
  questions,
  sessions,
  onNavigateToSession,
}: {
  questions: QuestionData[];
  sessions: SessionData[];
  onNavigateToSession: (sessionId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">Questions</h3>
        <span className="text-[11px] text-neutral-400 tabular-nums">
          {questions.length} total
        </span>
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {questions.map((q) => {
          const expanded = expandedId === q.id;
          const evidenceSessions = q.evidence
            ? sessions.filter((s) => q.evidence!.includes(s.id))
            : [];

          return (
            <div
              key={q.id}
              className={clsx(
                "rounded-lg border overflow-hidden transition-colors duration-150",
                expanded
                  ? "border-neutral-300 bg-white"
                  : "border-neutral-200 hover:border-neutral-300"
              )}
            >
              {/* Question header */}
              <button
                onClick={() => setExpandedId(expanded ? null : q.id)}
                className="w-full flex items-start gap-3 px-4 py-3 text-left"
              >
                {expanded ? (
                  <ChevronDown
                    size={14}
                    className="text-neutral-400 mt-0.5 shrink-0"
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    className="text-neutral-400 mt-0.5 shrink-0"
                  />
                )}
                <span className="text-[13px] text-neutral-900 flex-1">
                  {q.question}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono shrink-0 pt-0.5">
                  {q.id}
                </span>
              </button>

              {/* Expanded detail */}
              {expanded && (
                <div className="border-t border-neutral-200 p-4 space-y-3 animate-in">
                  {/* Ground truth */}
                  <div>
                    <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
                      Ground Truth
                    </span>
                    <p className="text-[13px] text-emerald-700 mt-1 leading-relaxed">
                      {q.groundTruth}
                    </p>
                  </div>

                  {/* Evidence links */}
                  {q.evidence && q.evidence.length > 0 && (
                    <div>
                      <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
                        Evidence
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {q.evidence.map((ref) => {
                          const sessionExists = sessions.some(
                            (s) => s.id === ref
                          );
                          return (
                            <button
                              key={ref}
                              onClick={() => {
                                if (sessionExists) onNavigateToSession(ref);
                              }}
                              disabled={!sessionExists}
                              className={clsx(
                                "px-2 py-1 rounded text-[11px] font-mono border transition-colors",
                                sessionExists
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                                  : "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-default"
                              )}
                            >
                              {ref}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Linked session previews */}
                  {evidenceSessions.length > 0 && (
                    <div>
                      <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">
                        Linked Sessions
                      </span>
                      <div className="space-y-1.5 mt-1.5">
                        {evidenceSessions.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => onNavigateToSession(s.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-left transition-colors"
                          >
                            <MessageSquare
                              size={12}
                              className="text-neutral-400 shrink-0"
                            />
                            <span className="text-xs font-medium text-neutral-700">
                              {s.id}
                            </span>
                            <span className="text-[11px] text-neutral-400 tabular-nums">
                              {s.messages.length} messages
                            </span>
                            {s.isAnswerSession && (
                              <Star
                                size={10}
                                className="text-emerald-500 fill-emerald-500 ml-auto shrink-0"
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Helpers ----

function highlightSearch(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded px-0.5">
        {text.slice(idx, idx + search.length)}
      </mark>
      {text.slice(idx + search.length)}
    </>
  );
}

// ---- Exported types ----

export type {
  ConversationsViewProps,
  ConversationData,
  SessionData,
  MessageData,
  MemoryData,
  QuestionData,
};

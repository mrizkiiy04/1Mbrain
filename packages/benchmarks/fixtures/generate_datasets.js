import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to calculate stop-word filtered keyword overlap
function getKeywordOverlap(qText, mText) {
  const stopWords = new Set(['what', 'is', 'the', 'how', 'to', 'for', 'of', 'in', 'on', 'a', 'an', 'and', 'should', 'we', 'are', 'you', 'i', 'my', 'what', 'which', 'was', 'were', 'who', 'whom', 'where', 'why', 'can', 'could', 'would', 'will', 'do', 'does', 'did', 'has', 'have', 'had', 'what', 'of', 'in', 'at']);
  const tokenize = text => text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w && !stopWords.has(w));
  
  const qTokens = new Set(tokenize(qText));
  const mTokens = tokenize(mText);
  if (qTokens.size === 0) return 0;
  
  let overlapCount = 0;
  const matchedTokens = new Set();
  for (const token of mTokens) {
    if (qTokens.has(token) && !matchedTokens.has(token)) {
      overlapCount++;
      matchedTokens.add(token);
    }
  }
  return overlapCount / qTokens.size;
}

// ----------------------------------------------------
// DATASET A: BALANCED MINI
// 8 conversations, 72 memories (9 per conv), 40 questions (5 per conv)
// ----------------------------------------------------
const datasetA = {
  name: "balanced-mini",
  description: "Fast balanced memory benchmark smoke test containing 8 conversations with 72 memory records and 40 questions.",
  generated_at: new Date().toISOString().split('T')[0],
  fairness_notes: [
    "No memory passport, decay, or explicit graph schema dependencies are assumed.",
    "Questions are distributed across exact retrieval, paraphrased semantic queries, and temporal updates.",
    "Graph-heavy questions are kept below 15% to prevent bias towards graph memory models."
  ],
  conversations: [
    {
      conversation_id: "da_c01_fastapi",
      agent_id: "da_agent_fastapi",
      domain: "software",
      memory_records: [
        {
          id: "da_c01_m01",
          type: "semantic",
          timestamp: "2026-06-10T10:00:00Z",
          content: "The developer prefers using Uvicorn with 4 workers for local development of the FastAPI server.",
          tags: ["fastapi", "uvicorn", "local-dev"],
          importance: 0.8,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c01_m02",
          type: "semantic",
          timestamp: "2026-06-10T10:05:00Z",
          content: "The database connection URI template is postgresql://user:pass@localhost:5432/dev_db.",
          tags: ["fastapi", "database", "postgres"],
          importance: 0.85,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c01_m03",
          type: "procedural",
          timestamp: "2026-06-10T10:10:00Z",
          content: "To update the database schema, run the command 'alembic upgrade head' in the root directory.",
          tags: ["fastapi", "alembic", "migration"],
          importance: 0.9,
          metadata: { source_turn: "t03", speaker: "user" }
        },
        {
          id: "da_c01_m04",
          type: "episodic",
          timestamp: "2026-06-10T10:15:00Z",
          content: "At 09:00, the database connection failed because the local Postgres container was stopped.",
          tags: ["fastapi", "database", "error"],
          importance: 0.7,
          metadata: { source_turn: "t04", speaker: "assistant" }
        },
        {
          id: "da_c01_m05",
          type: "semantic",
          timestamp: "2026-06-11T09:00:00Z",
          content: "On June 11, the developer decided that SQLite should be used for testing, replacing Postgres.",
          tags: ["fastapi", "database", "testing"],
          importance: 0.8,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c01_m06",
          type: "episodic",
          timestamp: "2026-06-11T09:10:00Z",
          content: "At 10:15, the developer reported that tests passed using the SQLite memory driver.",
          tags: ["fastapi", "testing", "success"],
          importance: 0.75,
          metadata: { source_turn: "t06", speaker: "assistant" }
        },
        {
          id: "da_c01_m07",
          type: "semantic",
          timestamp: "2026-06-12T11:00:00Z",
          content: "Noise: The project logo uses a green and blue color palette representing growth and stability.",
          tags: ["noise", "logo"],
          importance: 0.2,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c01_m08",
          type: "semantic",
          timestamp: "2026-06-12T11:05:00Z",
          content: "Noise: The server logs are stored in the folder /var/log/fastapi/app.log.",
          tags: ["noise", "logs"],
          importance: 0.3,
          metadata: { source_turn: "t08", speaker: "assistant" }
        },
        {
          id: "da_c01_m09",
          type: "semantic",
          timestamp: "2026-06-13T14:00:00Z",
          content: "The latest preference is to deploy on GCP Cloud Run using dockerized builds, replacing the older AWS ECS plan.",
          tags: ["fastapi", "deployment", "gcp"],
          importance: 0.9,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c01_q01",
          category: "atomic_fact_recall",
          question: "What connection URI template is configured for the dev database?",
          expected_answer: "postgresql://user:pass@localhost:5432/dev_db",
          acceptable_answer_criteria: ["postgresql://user:pass@localhost:5432/dev_db", "Postgres dev_db URI"],
          required_memory_ids: ["da_c01_m02"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval, basic vector search works perfectly."
        },
        {
          question_id: "da_c01_q02",
          category: "paraphrased_semantic_recall",
          question: "What is the preferred setup for running the local API server?",
          expected_answer: "Uvicorn with 4 workers",
          acceptable_answer_criteria: ["Uvicorn", "4 workers"],
          required_memory_ids: ["da_c01_m01"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Paraphrasing evaluates semantic similarity retrieval rather than simple keyword overlap."
        },
        {
          question_id: "da_c01_q03",
          category: "temporal_update",
          question: "Where should the application be deployed according to the latest decision?",
          expected_answer: "GCP Cloud Run using dockerized builds",
          acceptable_answer_criteria: ["GCP Cloud Run", "GCP", "Cloud Run"],
          required_memory_ids: ["da_c01_m09"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires checking timestamps or explicit updates to ignore outdated AWS plan."
        },
        {
          question_id: "da_c01_q04",
          category: "procedural_recall",
          question: "What command must be executed to migrate the database schema?",
          expected_answer: "alembic upgrade head",
          acceptable_answer_criteria: ["alembic upgrade head", "alembic"],
          required_memory_ids: ["da_c01_m03"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Retrieves a simple step-by-step procedural instruction."
        },
        {
          question_id: "da_c01_q05",
          category: "noise_resistance",
          question: "What is the file path where FastAPI server log files are written?",
          expected_answer: "/var/log/fastapi/app.log",
          acceptable_answer_criteria: ["/var/log/fastapi/app.log", "/var/log/fastapi"],
          required_memory_ids: ["da_c01_m08"],
          forbidden_memory_ids: ["da_c01_m07"],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Verifies the system can ignore unrelated design/color noise."
        }
      ]
    },
    {
      conversation_id: "da_c02_smart_home",
      agent_id: "da_agent_smart_home",
      domain: "personal_assistant",
      memory_records: [
        {
          id: "da_c02_m01",
          type: "semantic",
          timestamp: "2026-06-12T08:00:00Z",
          content: "The family prefers keeping the living room thermostat at 71 degrees Fahrenheit during daytime.",
          tags: ["home", "thermostat", "temperature"],
          importance: 0.8,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c02_m02",
          type: "semantic",
          timestamp: "2026-06-12T08:05:00Z",
          content: "The smart lock code for the back door is set to 4920 for house cleaner access.",
          tags: ["home", "security", "smart-lock"],
          importance: 0.9,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c02_m03",
          type: "episodic",
          timestamp: "2026-06-12T08:10:00Z",
          content: "The house cleaner, Maria, visits every Thursday at 10:00 AM.",
          tags: ["schedule", "cleaner", "house"],
          importance: 0.75,
          metadata: { source_turn: "t03", speaker: "user" },
          associations: [
            { target_id: "da_c02_m02", strength: 0.85, reason: "cleaner uses smart lock code" }
          ]
        },
        {
          id: "da_c02_m04",
          type: "semantic",
          timestamp: "2026-06-13T09:00:00Z",
          content: "Noise: The living room couch is covered with a beige slipcover to prevent dog hair stains.",
          tags: ["noise", "furniture"],
          importance: 0.2,
          metadata: { source_turn: "t04", speaker: "user" }
        },
        {
          id: "da_c02_m05",
          type: "semantic",
          timestamp: "2026-06-14T09:00:00Z",
          content: "On June 14, the daytime living room thermostat preference was updated to 73 degrees Fahrenheit for energy saving.",
          tags: ["home", "thermostat", "temperature"],
          importance: 0.85,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c02_m06",
          type: "episodic",
          timestamp: "2026-06-14T10:00:00Z",
          content: "The back door smart lock battery level dropped to 10% and needs replacement soon.",
          tags: ["home", "security", "battery"],
          importance: 0.7,
          metadata: { source_turn: "t06", speaker: "assistant" }
        },
        {
          id: "da_c02_m07",
          type: "semantic",
          timestamp: "2026-06-15T11:00:00Z",
          content: "The dog's name is Barnaby, and he eats dry kibble twice a day at 8:00 AM and 6:00 PM.",
          tags: ["pet", "schedule", "dog"],
          importance: 0.8,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c02_m08",
          type: "semantic",
          timestamp: "2026-06-15T11:15:00Z",
          content: "Noise: The backyard sprinkler system runs on Mondays and Thursdays at 6:00 AM.",
          tags: ["noise", "sprinklers"],
          importance: 0.3,
          metadata: { source_turn: "t08", speaker: "user" }
        },
        {
          id: "da_c02_m09",
          type: "semantic",
          timestamp: "2026-06-16T12:00:00Z",
          content: "The house cleaner's contact number is 555-0192.",
          tags: ["cleaner", "contact"],
          importance: 0.85,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c02_q01",
          category: "atomic_fact_recall",
          question: "What is the contact number of the house cleaner?",
          expected_answer: "555-0192",
          acceptable_answer_criteria: ["555-0192", "cleaner's phone number is 555-0192"],
          required_memory_ids: ["da_c02_m09"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Basic keyword overlap fact retrieval."
        },
        {
          question_id: "da_c02_q02",
          category: "paraphrased_semantic_recall",
          question: "What is the feeding schedule for Barnaby?",
          expected_answer: "Twice a day at 8:00 AM and 6:00 PM.",
          acceptable_answer_criteria: ["8:00 AM and 6:00 PM", "twice a day"],
          required_memory_ids: ["da_c02_m07"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests semantic mapping of 'feeding schedule' to 'eats dry kibble'."
        },
        {
          question_id: "da_c02_q03",
          category: "temporal_update",
          question: "What temperature should the living room be set to during the day?",
          expected_answer: "73 degrees Fahrenheit",
          acceptable_answer_criteria: ["73 degrees", "73 F", "73"],
          required_memory_ids: ["da_c02_m05"],
          forbidden_memory_ids: ["da_c02_m01"],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires checking timestamps to ensure the newer 73F setting overrides the older 71F setting."
        },
        {
          question_id: "da_c02_q04",
          category: "contradiction_resolution",
          question: "Is the living room thermostat still set to 71 degrees?",
          expected_answer: "No, it was updated to 73 degrees Fahrenheit on June 14.",
          acceptable_answer_criteria: ["No", "Updated to 73"],
          required_memory_ids: ["da_c02_m05", "da_c02_m01"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Resolves contradiction by looking at the update history."
        },
        {
          question_id: "da_c02_q05",
          category: "multi_hop_association",
          question: "What door entry code does Maria need when she visits on Thursdays?",
          expected_answer: "4920",
          acceptable_answer_criteria: ["4920", "smart lock code 4920"],
          required_memory_ids: ["da_c02_m02", "da_c02_m03"],
          forbidden_memory_ids: [],
          difficulty: "hard",
          architecture_bias_risk: "medium",
          fairness_note: "Requires linking Maria -> house cleaner -> smart lock code (4920). Solvable with either graph search or multi-evidence semantic retrieval."
        }
      ]
    },
    {
      conversation_id: "da_c03_quantum_sim",
      agent_id: "da_agent_quantum_sim",
      domain: "research",
      memory_records: [
        {
          id: "da_c03_m01",
          type: "semantic",
          timestamp: "2026-06-15T09:00:00Z",
          content: "The quantum simulator code uses a grid spacing parameter dx = 0.05 microns.",
          tags: ["physics", "quantum", "simulation"],
          importance: 0.8,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c03_m02",
          type: "semantic",
          timestamp: "2026-06-15T09:05:00Z",
          content: "The Hamiltonian solver converges only when the relaxation factor omega is set to 1.25.",
          tags: ["physics", "solver", "convergence"],
          importance: 0.85,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c03_m03",
          type: "episodic",
          timestamp: "2026-06-15T09:10:00Z",
          content: "Simulation run #402 stalled after 1500 iterations due to a floating point exception in the grid boundary code.",
          tags: ["physics", "simulation", "bug"],
          importance: 0.75,
          metadata: { source_turn: "t03", speaker: "assistant" }
        },
        {
          id: "da_c03_m04",
          type: "semantic",
          timestamp: "2026-06-15T09:15:00Z",
          content: "Noise: Dr. Henderson recommends using Python's NumPy library instead of SciPy for matrix division.",
          tags: ["noise", "numpy"],
          importance: 0.3,
          metadata: { source_turn: "t04", speaker: "user" }
        },
        {
          id: "da_c03_m05",
          type: "semantic",
          timestamp: "2026-06-16T10:00:00Z",
          content: "The grid spacing parameter dx was decreased to 0.02 microns to resolve numerical stability issues.",
          tags: ["physics", "quantum", "simulation"],
          importance: 0.85,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c03_m06",
          type: "semantic",
          timestamp: "2026-06-16T10:10:00Z",
          content: "Noise: The simulator outputs are saved in high-density HDF5 format by default.",
          tags: ["noise", "hdf5"],
          importance: 0.25,
          metadata: { source_turn: "t06", speaker: "assistant" }
        },
        {
          id: "da_c03_m07",
          type: "semantic",
          timestamp: "2026-06-17T11:00:00Z",
          content: "The quantum simulator utilizes the Crank-Nicolson method for time-stepping calculations.",
          tags: ["physics", "simulation", "math"],
          importance: 0.8,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c03_m08",
          type: "semantic",
          timestamp: "2026-06-17T11:20:00Z",
          content: "We use the GPU-accelerated CuPy backend for sparse matrix operations.",
          tags: ["physics", "simulation", "gpu"],
          importance: 0.85,
          metadata: { source_turn: "t08", speaker: "user" }
        },
        {
          id: "da_c03_m09",
          type: "semantic",
          timestamp: "2026-06-18T13:00:00Z",
          content: "The research project is titled 'Project Quasar' and is funded until December 2027.",
          tags: ["research", "admin"],
          importance: 0.7,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c03_q01",
          category: "atomic_fact_recall",
          question: "What relaxation factor is required for the Hamiltonian solver to converge?",
          expected_answer: "1.25",
          acceptable_answer_criteria: ["1.25", "omega is set to 1.25"],
          required_memory_ids: ["da_c03_m02"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c03_q02",
          category: "paraphrased_semantic_recall",
          question: "What mathematical approach is utilized for updating calculations across time?",
          expected_answer: "Crank-Nicolson method",
          acceptable_answer_criteria: ["Crank-Nicolson method", "Crank-Nicolson"],
          required_memory_ids: ["da_c03_m07"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests paraphrased query match mapping 'updating calculations across time' to 'time-stepping'."
        },
        {
          question_id: "da_c03_q03",
          category: "temporal_update",
          question: "What is the current grid spacing parameter dx used in the simulation?",
          expected_answer: "0.02 microns",
          acceptable_answer_criteria: ["0.02 microns", "0.02"],
          required_memory_ids: ["da_c03_m05"],
          forbidden_memory_ids: ["da_c03_m01"],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires checking timestamps to ensure the newer 0.02 setting overrides the older 0.05 setting."
        },
        {
          question_id: "da_c03_q04",
          category: "contradiction_resolution",
          question: "Did we increase the grid spacing parameter dx in our latest update?",
          expected_answer: "No, it was decreased to 0.02 microns to resolve numerical stability issues.",
          acceptable_answer_criteria: ["No, it was decreased", "No"],
          required_memory_ids: ["da_c03_m05", "da_c03_m01"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests the ability to resolve the direction of change in contradiction resolution."
        },
        {
          question_id: "da_c03_q05",
          category: "abstention",
          question: "Which specific GPU model is used to run the CuPy simulator?",
          expected_answer: "not enough information",
          acceptable_answer_criteria: ["not enough information", "insufficient evidence", "unknown"],
          required_memory_ids: [],
          forbidden_memory_ids: ["da_c03_m08"],
          difficulty: "hard",
          architecture_bias_risk: "low",
          fairness_note: "Verifies the system correctly abstains when the record mentions a GPU backend (CuPy) but not the specific GPU model."
        }
      ]
    },
    {
      conversation_id: "da_c04_tokyo_itinerary",
      agent_id: "da_agent_tokyo_itinerary",
      domain: "travel",
      memory_records: [
        {
          id: "da_c04_m01",
          type: "semantic",
          timestamp: "2026-06-01T10:00:00Z",
          content: "The traveler has a booking at Hotel Claska in Meguro, Tokyo, from October 12 to October 18.",
          tags: ["travel", "hotel", "tokyo"],
          importance: 0.85,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c04_m02",
          type: "semantic",
          timestamp: "2026-06-01T10:05:00Z",
          content: "The traveler prefers flying window seats on long-haul flights to sleep easily.",
          tags: ["travel", "flight", "preference"],
          importance: 0.8,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c04_m03",
          type: "episodic",
          timestamp: "2026-06-02T11:00:00Z",
          content: "The traveler booked flight JL005 from JFK to Haneda, departing at 1:15 PM on October 11.",
          tags: ["travel", "flight", "tokyo"],
          importance: 0.9,
          metadata: { source_turn: "t03", speaker: "user" },
          associations: [
            { target_id: "da_c04_m02", strength: 0.75, reason: "flight seat preferences" }
          ]
        },
        {
          id: "da_c04_m04",
          type: "semantic",
          timestamp: "2026-06-02T11:05:00Z",
          content: "Noise: The traveler's luggage is a medium-sized hard-shell suitcase in navy blue color.",
          tags: ["noise", "traveler-suitfall"],
          importance: 0.2,
          metadata: { source_turn: "t04", speaker: "user" }
        },
        {
          id: "da_c04_m05",
          type: "semantic",
          timestamp: "2026-06-03T09:00:00Z",
          content: "On June 3, the traveler changed the Tokyo accommodation plan to stay at Trunk Hotel in Shibuya instead of Hotel Claska.",
          tags: ["travel", "hotel", "tokyo"],
          importance: 0.85,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c04_m06",
          type: "episodic",
          timestamp: "2026-06-04T12:00:00Z",
          content: "The traveler bought a museum ticket for the teamLab Planets exhibit on October 14 at 2:00 PM.",
          tags: ["travel", "activity", "museum"],
          importance: 0.8,
          metadata: { source_turn: "t06", speaker: "user" }
        },
        {
          id: "da_c04_m07",
          type: "semantic",
          timestamp: "2026-06-04T12:05:00Z",
          content: "Noise: Tokyo temperatures in mid-October average 15 to 22 degrees Celsius.",
          tags: ["noise", "weather"],
          importance: 0.3,
          metadata: { source_turn: "t07", speaker: "assistant" }
        },
        {
          id: "da_c04_m08",
          type: "semantic",
          timestamp: "2026-06-05T10:00:00Z",
          content: "The traveler enjoys visiting traditional tempura restaurants and prefers reservations for dinner.",
          tags: ["travel", "food", "dining"],
          importance: 0.75,
          metadata: { source_turn: "t08", speaker: "user" }
        },
        {
          id: "da_c04_m09",
          type: "semantic",
          timestamp: "2026-06-05T10:30:00Z",
          content: "The passenger name in the airline booking is listed as Sarah Miller.",
          tags: ["travel", "identity"],
          importance: 0.8,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c04_q01",
          category: "atomic_fact_recall",
          question: "What is the departure time and flight number for the JFK to Haneda flight?",
          expected_answer: "Flight JL005 departing at 1:15 PM.",
          acceptable_answer_criteria: ["Flight JL005", "1:15 PM", "JL005"],
          required_memory_ids: ["da_c04_m03"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c04_q02",
          category: "paraphrased_semantic_recall",
          question: "What type of seating does Sarah Miller prefer on long airplane journeys?",
          expected_answer: "Window seats",
          acceptable_answer_criteria: ["window", "window seat"],
          required_memory_ids: ["da_c04_m02", "da_c04_m09"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests semantic mapping of 'long airplane journeys' to 'long-haul flights' and uses passenger name 'Sarah Miller' from another record."
        },
        {
          question_id: "da_c04_q03",
          category: "temporal_update",
          question: "Where is the traveler staying in Tokyo during their visit?",
          expected_answer: "Trunk Hotel in Shibuya",
          acceptable_answer_criteria: ["Trunk Hotel", "Trunk Hotel in Shibuya", "Trunk"],
          required_memory_ids: ["da_c04_m05"],
          forbidden_memory_ids: ["da_c04_m01"],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires retrieving the updated Trunk Hotel choice rather than the old Hotel Claska plan."
        },
        {
          question_id: "da_c04_q04",
          category: "noise_resistance",
          question: "What is the date and time of the teamLab Planets ticket?",
          expected_answer: "October 14 at 2:00 PM",
          acceptable_answer_criteria: ["October 14", "2:00 PM"],
          required_memory_ids: ["da_c04_m06"],
          forbidden_memory_ids: ["da_c04_m07", "da_c04_m04"],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Tests retrieval quality when ignores irrelevant weather and luggage color metadata."
        },
        {
          question_id: "da_c04_q05",
          category: "multi_hop_association",
          question: "What seat selection is preferred for the traveler's flight JL005 on October 11?",
          expected_answer: "Window seat",
          acceptable_answer_criteria: ["window seat", "window"],
          required_memory_ids: ["da_c04_m02", "da_c04_m03"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "medium",
          fairness_note: "Tests link between flight JL005 -> long-haul flight -> window seat preference."
        }
      ]
    },
    {
      conversation_id: "da_c05_diabetes_admin",
      agent_id: "da_agent_diabetes_admin",
      domain: "health_admin",
      memory_records: [
        {
          id: "da_c05_m01",
          type: "semantic",
          timestamp: "2026-06-05T08:00:00Z",
          content: "The patient is insured under Blue Shield PPO, Policy ID #BS-9021-X.",
          tags: ["health", "insurance", "policy"],
          importance: 0.85,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c05_m02",
          type: "semantic",
          timestamp: "2026-06-05T08:05:00Z",
          content: "The patient's endocrinologist is Dr. Robert Vance, located at the Vance Clinic on Oak Street.",
          tags: ["health", "doctor", "endocrinologist"],
          importance: 0.8,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c05_m03",
          type: "episodic",
          timestamp: "2026-06-05T08:10:00Z",
          content: "The patient has a scheduled routine blood draw appointment on June 20 at 7:30 AM at Oak Laboratories.",
          tags: ["health", "appointment", "labs"],
          importance: 0.9,
          metadata: { source_turn: "t03", speaker: "user" },
          associations: [
            { target_id: "da_c05_m02", strength: 0.8, reason: "doctor ordered blood draw" }
          ]
        },
        {
          id: "da_c05_m04",
          type: "semantic",
          timestamp: "2026-06-05T08:15:00Z",
          content: "Noise: The Vance Clinic building has a red brick facade with a parking lot in the rear.",
          tags: ["noise", "clinic"],
          importance: 0.2,
          metadata: { source_turn: "t04", speaker: "assistant" }
        },
        {
          id: "da_c05_m05",
          type: "semantic",
          timestamp: "2026-06-06T09:00:00Z",
          content: "On June 6, the patient's insurance plan was updated to Cigna Gold Open Access, Policy ID #CI-8401-Y, due to employer benefits change.",
          tags: ["health", "insurance", "policy"],
          importance: 0.9,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c05_m06",
          type: "episodic",
          timestamp: "2026-06-06T10:00:00Z",
          content: "The patient completed their annual physical examination on June 2 and was advised to exercise 30 minutes daily.",
          tags: ["health", "physical", "exercise"],
          importance: 0.8,
          metadata: { source_turn: "t06", speaker: "assistant" }
        },
        {
          id: "da_c05_m07",
          type: "semantic",
          timestamp: "2026-06-07T11:00:00Z",
          content: "The patient takes Metformin 500mg twice daily with meals to manage blood sugar levels.",
          tags: ["health", "prescription", "diabetes"],
          importance: 0.85,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c05_m08",
          type: "semantic",
          timestamp: "2026-06-07T11:15:00Z",
          content: "Noise: Blue Shield PPO customer service phone line is open 24 hours for emergency inquiries.",
          tags: ["noise", "insurance"],
          importance: 0.3,
          metadata: { source_turn: "t08", speaker: "user" }
        },
        {
          id: "da_c05_m09",
          type: "semantic",
          timestamp: "2026-06-08T12:00:00Z",
          content: "The primary pharmacy is Walgreens on 4th Avenue, which has a drive-through window.",
          tags: ["health", "pharmacy"],
          importance: 0.75,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c05_q01",
          category: "atomic_fact_recall",
          question: "What dosage of Metformin is the patient prescribed to take?",
          expected_answer: "500mg twice daily",
          acceptable_answer_criteria: ["500mg twice daily", "500mg", "twice a day"],
          required_memory_ids: ["da_c05_m07"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c05_q02",
          category: "paraphrased_semantic_recall",
          question: "Where does the patient get their prescriptions filled?",
          expected_answer: "Walgreens on 4th Avenue",
          acceptable_answer_criteria: ["Walgreens", "Walgreens on 4th Avenue"],
          required_memory_ids: ["da_c05_m09"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests semantic mapping of 'where does the patient get their prescriptions filled' to 'primary pharmacy'."
        },
        {
          question_id: "da_c05_q03",
          category: "temporal_update",
          question: "What is the patient's current insurance provider and Policy ID?",
          expected_answer: "Cigna Gold Open Access, Policy ID #CI-8401-Y",
          acceptable_answer_criteria: ["Cigna", "CI-8401-Y"],
          required_memory_ids: ["da_c05_m05"],
          forbidden_memory_ids: ["da_c05_m01"],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires checking timestamps to ensure the Cigna policy overrides the old Blue Shield policy."
        },
        {
          question_id: "da_c05_q04",
          category: "contradiction_resolution",
          question: "Is the patient's active health policy still Blue Shield PPO?",
          expected_answer: "No, it was updated to Cigna Gold Open Access on June 6.",
          acceptable_answer_criteria: ["No, it is Cigna", "No"],
          required_memory_ids: ["da_c05_m05", "da_c05_m01"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests contradiction handling between old Blue Shield and current Cigna policies."
        },
        {
          question_id: "da_c05_q05",
          category: "multi_hop_association",
          question: "At which laboratory is the blood draw requested by Dr. Robert Vance scheduled?",
          expected_answer: "Oak Laboratories",
          acceptable_answer_criteria: ["Oak Laboratories", "Oak Labs"],
          required_memory_ids: ["da_c05_m03", "da_c05_m02"],
          forbidden_memory_ids: [],
          difficulty: "hard",
          architecture_bias_risk: "medium",
          fairness_note: "Requires connecting Dr. Vance -> ordered blood draw -> Oak Laboratories appointment."
        }
      ]
    },
    {
      conversation_id: "da_c06_tax_prep",
      agent_id: "da_agent_tax_prep",
      domain: "finance_admin",
      memory_records: [
        {
          id: "da_c06_m01",
          type: "semantic",
          timestamp: "2026-06-01T10:00:00Z",
          content: "The user has a primary checking account at Chase Bank with routing number #***0912.",
          tags: ["finance", "bank", "chase"],
          importance: 0.8,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c06_m02",
          type: "semantic",
          timestamp: "2026-06-01T10:05:00Z",
          content: "The tax consultant is Evelyn Mercer, who works at Mercer Tax Services.",
          tags: ["finance", "tax", "consultant"],
          importance: 0.85,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c06_m03",
          type: "episodic",
          timestamp: "2026-06-02T09:00:00Z",
          content: "The user submitted Form 1099-NEC for freelance earnings of $14,200 from Apex Systems.",
          tags: ["finance", "tax", "income"],
          importance: 0.9,
          metadata: { source_turn: "t03", speaker: "user" },
          associations: [
            { target_id: "da_c06_m02", strength: 0.8, reason: "Evelyn Mercer prepares tax submission" }
          ]
        },
        {
          id: "da_c06_m04",
          type: "semantic",
          timestamp: "2026-06-02T09:10:00Z",
          content: "Noise: Chase Bank's branch in downtown has a revolving door and 4 teller counters.",
          tags: ["noise", "chase"],
          importance: 0.2,
          metadata: { source_turn: "t04", speaker: "assistant" }
        },
        {
          id: "da_c06_m05",
          type: "semantic",
          timestamp: "2026-06-03T11:00:00Z",
          content: "On June 3, the user opened a business checking account at Silicon Valley Bank (SVB) to replace Chase for all future freelance income deposits.",
          tags: ["finance", "bank", "svb"],
          importance: 0.9,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c06_m06",
          type: "episodic",
          timestamp: "2026-06-03T12:00:00Z",
          content: "The user paid a tax preparation deposit of $150 to Mercer Tax Services using their credit card.",
          tags: ["finance", "payment", "tax"],
          importance: 0.8,
          metadata: { source_turn: "t06", speaker: "user" }
        },
        {
          id: "da_c06_m07",
          type: "semantic",
          timestamp: "2026-06-04T10:00:00Z",
          content: "The quarterly estimated tax payment deadline for Q2 is June 15.",
          tags: ["finance", "tax", "deadline"],
          importance: 0.85,
          metadata: { source_turn: "t07", speaker: "assistant" }
        },
        {
          id: "da_c06_m08",
          type: "semantic",
          timestamp: "2026-06-04T10:15:00Z",
          content: "Noise: Mercer Tax Services logo has a scales of justice symbol in gold and navy colors.",
          tags: ["noise", "tax"],
          importance: 0.3,
          metadata: { source_turn: "t08", speaker: "user" }
        },
        {
          id: "da_c06_m09",
          type: "semantic",
          timestamp: "2026-06-05T13:00:00Z",
          content: "The user has a personal retirement traditional IRA account at Fidelity with a 2026 contribution limit of $7,000.",
          tags: ["finance", "ira", "fidelity"],
          importance: 0.8,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c06_q01",
          category: "atomic_fact_recall",
          question: "What routing number is associated with the Chase Bank checking account?",
          expected_answer: "#***0912",
          acceptable_answer_criteria: ["#***0912", "routing number #***0912"],
          required_memory_ids: ["da_c06_m01"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c06_q02",
          category: "paraphrased_semantic_recall",
          question: "Who is handling the user's tax consultancy work?",
          expected_answer: "Evelyn Mercer at Mercer Tax Services",
          acceptable_answer_criteria: ["Evelyn Mercer", "Mercer Tax Services"],
          required_memory_ids: ["da_c06_m02"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests semantic mapping of 'tax consultancy work' to 'tax consultant'."
        },
        {
          question_id: "da_c06_q03",
          category: "temporal_update",
          question: "Where should future freelance earnings be deposited according to the latest decision?",
          expected_answer: "Silicon Valley Bank (SVB)",
          acceptable_answer_criteria: ["Silicon Valley Bank", "SVB"],
          required_memory_ids: ["da_c06_m05"],
          forbidden_memory_ids: ["da_c06_m01"],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Requires identifying the new bank account (SVB) replacing the old bank account (Chase)."
        },
        {
          question_id: "da_c06_q04",
          category: "contradiction_resolution",
          question: "Is Chase Bank still the active checking account for freelance income?",
          expected_answer: "No, it was replaced by Silicon Valley Bank (SVB) on June 3.",
          acceptable_answer_criteria: ["No, it was replaced by SVB", "No"],
          required_memory_ids: ["da_c06_m05", "da_c06_m01"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Verifies the system resolves contradiction and correctly updates active account."
        },
        {
          question_id: "da_c06_q05",
          category: "abstention",
          question: "What is the account number of the traditional IRA at Fidelity?",
          expected_answer: "not enough information",
          acceptable_answer_criteria: ["not enough information", "insufficient evidence", "unknown"],
          required_memory_ids: [],
          forbidden_memory_ids: ["da_c06_m09"],
          difficulty: "hard",
          architecture_bias_risk: "low",
          fairness_note: "Tests abstention: the user mentioned having a traditional IRA at Fidelity but never shared the account number."
        }
      ]
    },
    {
      conversation_id: "da_c07_linear_algebra",
      agent_id: "da_agent_linear_algebra",
      domain: "education",
      memory_records: [
        {
          id: "da_c07_m01",
          type: "semantic",
          timestamp: "2026-06-01T09:00:00Z",
          content: "The Linear Algebra course has weekly quizzes that open on Friday and close on Sunday night.",
          tags: ["education", "math", "quizzes"],
          importance: 0.8,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c07_m02",
          type: "semantic",
          timestamp: "2026-06-01T09:05:00Z",
          content: "The mid-term exam is scheduled for October 15 and covers vector spaces, eigenvalues, and linear transformations.",
          tags: ["education", "math", "midterm"],
          importance: 0.9,
          metadata: { source_turn: "t02", speaker: "user" }
        },
        {
          id: "da_c07_m03",
          type: "semantic",
          timestamp: "2026-06-01T09:10:00Z",
          content: "The required textbook is 'Introduction to Linear Algebra' by Gilbert Strang, 5th Edition.",
          tags: ["education", "math", "textbook"],
          importance: 0.85,
          metadata: { source_turn: "t03", speaker: "user" },
          associations: [
            { target_id: "da_c07_m02", strength: 0.7, reason: "study source for midterm" }
          ]
        },
        {
          id: "da_c07_m04",
          type: "semantic",
          timestamp: "2026-06-01T09:15:00Z",
          content: "Noise: The lecturer, Professor Adams, likes to drink hot black coffee during morning sessions.",
          tags: ["noise", "professor"],
          importance: 0.2,
          metadata: { source_turn: "t04", speaker: "assistant" }
        },
        {
          id: "da_c07_m05",
          type: "episodic",
          timestamp: "2026-06-02T10:00:00Z",
          content: "The user achieved a score of 92/100 on Homework Assignment 1.",
          tags: ["education", "grade", "homework"],
          importance: 0.8,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c07_m06",
          type: "semantic",
          timestamp: "2026-06-02T10:05:00Z",
          content: "Noise: Homework assignments must be uploaded in PDF format only.",
          tags: ["noise", "format"],
          importance: 0.3,
          metadata: { source_turn: "t06", speaker: "assistant" }
        },
        {
          id: "da_c07_m07",
          type: "semantic",
          timestamp: "2026-06-03T11:00:00Z",
          content: "The teaching assistant is named Marcus Vance, and his office hours are Wednesdays from 2:00 PM to 4:00 PM.",
          tags: ["education", "math", "office-hours"],
          importance: 0.8,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c07_m08",
          type: "semantic",
          timestamp: "2026-06-03T11:15:00Z",
          content: "Office hours are located in Room 402 of the Mathematics Building.",
          tags: ["education", "math", "location"],
          importance: 0.75,
          metadata: { source_turn: "t08", speaker: "user" },
          associations: [
            { target_id: "da_c07_m07", strength: 0.9, reason: "TA's office location" }
          ]
        },
        {
          id: "da_c07_m09",
          type: "semantic",
          timestamp: "2026-06-04T12:00:00Z",
          content: "The class Zoom password is 'Eigen2026'.",
          tags: ["education", "math", "zoom"],
          importance: 0.85,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c07_q01",
          category: "atomic_fact_recall",
          question: "What textbook edition is required for the Linear Algebra course?",
          expected_answer: "'Introduction to Linear Algebra' by Gilbert Strang, 5th Edition.",
          acceptable_answer_criteria: ["Strang 5th Edition", "Gilbert Strang", "5th Edition"],
          required_memory_ids: ["da_c07_m03"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c07_q02",
          category: "atomic_fact_recall",
          question: "What is the date of the midterm exam and what topics does it cover?",
          expected_answer: "October 15, covering vector spaces, eigenvalues, and linear transformations.",
          acceptable_answer_criteria: ["October 15", "vector spaces", "eigenvalues", "linear transformations"],
          required_memory_ids: ["da_c07_m02"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Direct details fact retrieval."
        },
        {
          question_id: "da_c07_q03",
          category: "paraphrased_semantic_recall",
          question: "What is the password to access virtual course video conferences?",
          expected_answer: "Eigen2026",
          acceptable_answer_criteria: ["Eigen2026", "class Zoom password 'Eigen2026'"],
          required_memory_ids: ["da_c07_m09"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests semantic mapping of 'virtual course video conferences' to 'class Zoom'."
        },
        {
          question_id: "da_c07_q04",
          category: "noise_resistance",
          question: "What grade did the user receive on the first Homework Assignment?",
          expected_answer: "92/100",
          acceptable_answer_criteria: ["92/100", "92"],
          required_memory_ids: ["da_c07_m05"],
          forbidden_memory_ids: ["da_c07_m04", "da_c07_m06"],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Verifies ignoring coffee drinking preference and PDF upload requirements."
        },
        {
          question_id: "da_c07_q05",
          category: "multi_hop_association",
          question: "Where should the student go to meet teaching assistant Marcus Vance in person?",
          expected_answer: "Room 402 of the Mathematics Building",
          acceptable_answer_criteria: ["Room 402", "Math Building Room 402"],
          required_memory_ids: ["da_c07_m07", "da_c07_m08"],
          forbidden_memory_ids: [],
          difficulty: "hard",
          architecture_bias_risk: "medium",
          fairness_note: "Requires linking Marcus Vance -> TA -> office location in Room 402 of the Mathematics Building."
        }
      ]
    },
    {
      conversation_id: "da_c08_novel_outline",
      agent_id: "da_agent_novel_outline",
      domain: "creative_work",
      memory_records: [
        {
          id: "da_c08_m01",
          type: "semantic",
          timestamp: "2026-06-01T10:00:00Z",
          content: "The main character of the sci-fi novel is Captain Vance Rennold, commander of the starship 'Nebula'.",
          tags: ["creative", "novel", "character"],
          importance: 0.85,
          metadata: { source_turn: "t01", speaker: "user" }
        },
        {
          id: "da_c08_m02",
          type: "semantic",
          timestamp: "2026-06-01T10:05:00Z",
          content: "Captain Rennold's primary motivation is finding the lost colony of Elysium to rescue his sister.",
          tags: ["creative", "novel", "character-motive"],
          importance: 0.8,
          metadata: { source_turn: "t02", speaker: "user" },
          associations: [
            { target_id: "da_c08_m01", strength: 0.85, reason: "character detail" }
          ]
        },
        {
          id: "da_c08_m03",
          type: "semantic",
          timestamp: "2026-06-01T10:10:00Z",
          content: "The starship 'Nebula' is powered by a rare dark-matter core that requires cooling every 24 hours.",
          tags: ["creative", "novel", "lore"],
          importance: 0.8,
          metadata: { source_turn: "t03", speaker: "user" }
        },
        {
          id: "da_c08_m04",
          type: "semantic",
          timestamp: "2026-06-01T10:15:00Z",
          content: "Noise: The starship control deck features chrome surfaces and blue neon status panels.",
          tags: ["noise", "starship-deck"],
          importance: 0.25,
          metadata: { source_turn: "t04", speaker: "assistant" }
        },
        {
          id: "da_c08_m05",
          type: "procedural",
          timestamp: "2026-06-02T09:00:00Z",
          content: "To build narrative tension in Chapter 3, outline the following steps: first, introduce the cooling system failure; second, force a hard landing on an asteroid; third, trigger a conflict between Rennold and the engineer.",
          tags: ["creative", "novel", "outline"],
          importance: 0.9,
          metadata: { source_turn: "t05", speaker: "user" }
        },
        {
          id: "da_c08_m06",
          type: "semantic",
          timestamp: "2026-06-02T10:00:00Z",
          content: "Noise: The author uses Scrivener for drafting and Google Docs for sharing review copies.",
          tags: ["noise", "software"],
          importance: 0.3,
          metadata: { source_turn: "t06", speaker: "user" }
        },
        {
          id: "da_c08_m07",
          type: "semantic",
          timestamp: "2026-06-03T11:00:00Z",
          content: "The primary antagonist is Commander Sarah Drake, head of the Orion Syndicate.",
          tags: ["creative", "novel", "character"],
          importance: 0.85,
          metadata: { source_turn: "t07", speaker: "user" }
        },
        {
          id: "da_c08_m08",
          type: "semantic",
          timestamp: "2026-06-03T11:15:00Z",
          content: "The Orion Syndicate operates from a hidden space station orbiting the gas giant Jupiter.",
          tags: ["creative", "novel", "lore"],
          importance: 0.8,
          metadata: { source_turn: "t08", speaker: "user" },
          associations: [
            { target_id: "da_c08_m07", strength: 0.9, reason: "antagonist's organization location" }
          ]
        },
        {
          id: "da_c08_m09",
          type: "semantic",
          timestamp: "2026-06-04T12:00:00Z",
          content: "The novel's working title is 'Shattered Nebula' and the word count goal is 80,000 words.",
          tags: ["creative", "novel", "metadata"],
          importance: 0.7,
          metadata: { source_turn: "t09", speaker: "user" }
        }
      ],
      questions: [
        {
          question_id: "da_c08_q01",
          category: "atomic_fact_recall",
          question: "Who is the primary antagonist of the sci-fi novel?",
          expected_answer: "Commander Sarah Drake",
          acceptable_answer_criteria: ["Sarah Drake", "Commander Sarah Drake"],
          required_memory_ids: ["da_c08_m07"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct exact match fact retrieval."
        },
        {
          question_id: "da_c08_q02",
          category: "atomic_fact_recall",
          question: "What is the working title of the book and its target word count?",
          expected_answer: "'Shattered Nebula' with an 80,000 words target.",
          acceptable_answer_criteria: ["Shattered Nebula", "80,000 words", "80k000 words"],
          required_memory_ids: ["da_c08_m09"],
          forbidden_memory_ids: [],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Direct metadata fact lookup."
        },
        {
          question_id: "da_c08_q03",
          category: "paraphrased_semantic_recall",
          question: "What drives Captain Rennold to search the galaxy?",
          expected_answer: "Finding the lost colony of Elysium to rescue his sister.",
          acceptable_answer_criteria: ["rescuing his sister", "finding Elysium", "his sister"],
          required_memory_ids: ["da_c08_m02"],
          forbidden_memory_ids: [],
          difficulty: "medium",
          architecture_bias_risk: "low",
          fairness_note: "Tests paraphrased mapping from 'drives Captain Rennold to search the galaxy' to 'primary motivation'."
        },
        {
          question_id: "da_c08_q04",
          category: "noise_resistance",
          question: "How is the starship 'Nebula' powered?",
          expected_answer: "A rare dark-matter core.",
          acceptable_answer_criteria: ["dark-matter core", "dark-matter"],
          required_memory_ids: ["da_c08_m03"],
          forbidden_memory_ids: ["da_c08_m04", "da_c08_m06"],
          difficulty: "easy",
          architecture_bias_risk: "low",
          fairness_note: "Ensures model ignores visual control deck chrome description and software like Scrivener."
        },
        {
          question_id: "da_c08_q05",
          category: "procedural_recall",
          question: "What steps are planned to build narrative tension in the third chapter?",
          expected_answer: "First, introduce cooling system failure; second, force a hard landing on an asteroid; third, trigger a conflict between Rennold and the engineer.",
          acceptable_answer_criteria: ["cooling system failure", "hard landing on an asteroid", "conflict with engineer"],
          required_memory_ids: ["da_c08_m05"],
          forbidden_memory_ids: [],
          difficulty: "hard",
          architecture_bias_risk: "low",
          fairness_note: "Retrieves a multi-step writing procedure."
        }
      ]
    }
  ]
};

// ----------------------------------------------------
// DATASET C: ADVERSARIAL MEMORY
// 10 conversations, 120 memories (12 per conv), 60 questions (6 per conv)
// Focus: stale facts, contradictions, distractors, ambiguity, and abstention
// ----------------------------------------------------
const datasetC = {
  name: "adversarial-memory",
  description: "Adversarial memory benchmark dataset containing 10 conversations with 120 memory records and 60 questions, testing contradiction handling, noise, and abstention.",
  generated_at: new Date().toISOString().split('T')[0],
  fairness_notes: [
    "Tests capacity to handle stale values, contradicting facts, and noise resistance without graph bias.",
    "Abstention questions ensure systems know when evidence is insufficient."
  ],
  conversations: []
};

// Category allocation list for C: 60 questions total
// 25% atomic fact recall = 15 questions
// 20% paraphrased semantic recall = 12 questions
// 15% temporal/current preference = 9 questions
// 10% contradiction resolution = 6 questions
// 10% multi-hop association = 6 questions
// 10% noise resistance = 6 questions
// 5% procedural recall = 3 questions
// 5% abstention = 3 questions
const categoriesC = [
  ...Array(15).fill("atomic_fact_recall"),
  ...Array(12).fill("paraphrased_semantic_recall"),
  ...Array(9).fill("temporal_update"),
  ...Array(6).fill("contradiction_resolution"),
  ...Array(6).fill("multi_hop_association"),
  ...Array(6).fill("noise_resistance"),
  ...Array(3).fill("procedural_recall"),
  ...Array(3).fill("abstention")
];

const domainsC = ["software", "personal_assistant", "research", "travel", "health_admin", "finance_admin", "education", "creative_work", "software", "personal_assistant"];

for (let i = 0; i < 10; i++) {
  const cNum = String(i + 1).padStart(2, '0');
  const domain = domainsC[i];
  const records = [];
  const questions = [];
  const dName = domain.toUpperCase();
  
  // Hand-craft 12 adversarial records per conversation
  records.push(
    { id: `dc_c${cNum}_m01`, type: "semantic", timestamp: "2026-06-01T10:00:00Z", content: `The main parameters designated for ${dName} are value Alpha.`, tags: [domain, "param"], importance: 0.8, metadata: { source_turn: "t1", speaker: "user" } },
    { id: `dc_c${cNum}_m02`, type: "semantic", timestamp: "2026-06-01T10:05:00Z", content: `The secondary configuration option for ${dName} is value Beta.`, tags: [domain, "param"], importance: 0.8, metadata: { source_turn: "t2", speaker: "user" } },
    { id: `dc_c${cNum}_m03`, type: "semantic", timestamp: "2026-06-01T10:10:00Z", content: `Distractor: The color of the ${dName} report sheet is yellow.`, tags: ["noise"], importance: 0.2, metadata: { source_turn: "t3", speaker: "assistant" } },
    { id: `dc_c${cNum}_m04`, type: "semantic", timestamp: "2026-06-02T10:00:00Z", content: `On June 2, the main parameter configuration for ${dName} was updated to Gamma.`, tags: [domain, "param"], importance: 0.9, metadata: { source_turn: "t4", speaker: "user" } },
    { id: `dc_c${cNum}_m05`, type: "semantic", timestamp: "2026-06-03T11:00:00Z", content: `On June 3, the secondary configuration option for ${dName} was changed to Delta.`, tags: [domain, "param"], importance: 0.9, metadata: { source_turn: "t5", speaker: "user" } },
    { id: `dc_c${cNum}_m06`, type: "procedural", timestamp: "2026-06-04T09:00:00Z", content: `To apply modifications to the ${dName} registry: 1. check credentials, 2. submit form, 3. wait for email.`, tags: [domain, "process"], importance: 0.85, metadata: { source_turn: "t6", speaker: "user" } },
    { id: `dc_c${cNum}_m07`, type: "semantic", timestamp: "2026-06-04T09:05:00Z", content: `Distractor: Email server is active on port 25.`, tags: ["noise"], importance: 0.3, metadata: { source_turn: "t7", speaker: "assistant" } },
    { id: `dc_c${cNum}_m08`, type: "semantic", timestamp: "2026-06-05T10:00:00Z", content: `The registry workspace for ${dName} is located at building Room 10.`, tags: [domain], importance: 0.8, metadata: { source_turn: "t8", speaker: "user" }, associations: [{ target_id: `dc_c${cNum}_m06`, strength: 0.7 }] },
    { id: `dc_c${cNum}_m09`, type: "semantic", timestamp: "2026-06-05T10:10:00Z", content: `The client contact liaison for ${dName} is Mary Jane.`, tags: [domain], importance: 0.7, metadata: { source_turn: "t9", speaker: "user" } },
    { id: `dc_c${cNum}_m10`, type: "semantic", timestamp: "2026-06-06T12:00:00Z", content: `On June 6, the client contact liaison for ${dName} was changed to Peter Parker.`, tags: [domain], importance: 0.9, metadata: { source_turn: "t10", speaker: "user" } },
    { id: `dc_c${cNum}_m11`, type: "semantic", timestamp: "2026-06-06T12:05:00Z", content: `Distractor: Peter Parker works as a freelance photographer.`, tags: ["noise"], importance: 0.2, metadata: { source_turn: "t11", speaker: "assistant" } },
    { id: `dc_c${cNum}_m12`, type: "semantic", timestamp: "2026-06-07T13:00:00Z", content: `The manager for the ${dName} task is George Lucas.`, tags: [domain, "manager"], importance: 0.8, metadata: { source_turn: "t12", speaker: "user" } }
  );

  const startIdx = i * 6;
  const categoriesList = categoriesC.slice(startIdx, startIdx + 6);
  
  for (let q = 0; q < 6; q++) {
    const category = categoriesList[q];
    const qId = `dc_c${cNum}_q${q + 1}`;
    let questionText = "";
    let expectedAnswer = "";
    let criteria = [];
    let requiredMemoryIds = [];
    let forbiddenMemoryIds = [];
    
    if (category === "atomic_fact_recall") {
      // Paraphrased: "Who holds administrative coordination authority..."
      questionText = `Who is in charge of administrative coordination for the ${dName} task?`;
      expectedAnswer = `George Lucas`;
      criteria = ["George Lucas", "George"];
      requiredMemoryIds = [`dc_c${cNum}_m12`];
    } else if (category === "paraphrased_semantic_recall") {
      // Paraphrased: "What specific environment configuration version..."
      questionText = `What is the primary variable value currently designated for the ${dName} project?`;
      expectedAnswer = `Gamma`;
      criteria = ["Gamma"];
      requiredMemoryIds = [`dc_c${cNum}_m04`];
      forbiddenMemoryIds = [`dc_c${cNum}_m01`];
    } else if (category === "temporal_update") {
      // Paraphrased: "Identify the active software package..."
      questionText = `What is the secondary parameter value active for ${dName}?`;
      expectedAnswer = `Delta`;
      criteria = ["Delta"];
      requiredMemoryIds = [`dc_c${cNum}_m05`];
      forbiddenMemoryIds = [`dc_c${cNum}_m02`];
    } else if (category === "contradiction_resolution") {
      // Paraphrased: "Does Mary Jane still serve as..."
      questionText = `Does Mary Jane still serve as the primary external liaison for the ${dName} engagement?`;
      expectedAnswer = `No, it was updated to Peter Parker on June 6.`;
      criteria = ["No, it is Peter Parker", "No", "Peter Parker"];
      requiredMemoryIds = [`dc_c${cNum}_m10`, `dc_c${cNum}_m09`];
    } else if (category === "multi_hop_association") {
      // Paraphrased: "Where is the workspace located..."
      questionText = `Where should we go to apply updates to the registry for the ${dName} task?`;
      expectedAnswer = `Room 10`;
      criteria = ["Room 10", "building Room 10"];
      requiredMemoryIds = [`dc_c${cNum}_m08`, `dc_c${cNum}_m06`];
    } else if (category === "noise_resistance") {
      // Paraphrased: "What steps are necessary..."
      questionText = `What is the procedure for enacting modifications on the ${dName} registry?`;
      expectedAnswer = `1. check credentials, 2. submit form, 3. wait for email`;
      criteria = ["check credentials", "submit form", "wait for email"];
      requiredMemoryIds = [`dc_c${cNum}_m06`];
      forbiddenMemoryIds = [`dc_c${cNum}_m07`];
    } else if (category === "procedural_recall") {
      questionText = `What steps are necessary to execute the ${dName} update?`;
      expectedAnswer = `1. check credentials, 2. submit form, 3. wait for email.`;
      criteria = ["check credentials", "submit form", "wait for email"];
      requiredMemoryIds = [`dc_c${cNum}_m06`];
    } else if (category === "abstention") {
      // Paraphrased: "Which telephone contact number..."
      questionText = `Which telephone contact number should we call to reach the director of ${dName}?`;
      expectedAnswer = `not enough information`;
      criteria = ["not enough information", "unknown", "insufficient evidence"];
      requiredMemoryIds = [];
      forbiddenMemoryIds = [`dc_c${cNum}_m12`];
    }
    
    questions.push({
      question_id: qId,
      category: category,
      question: questionText,
      expected_answer: expectedAnswer,
      acceptable_answer_criteria: criteria,
      required_memory_ids: requiredMemoryIds,
      forbidden_memory_ids: forbiddenMemoryIds,
      difficulty: category === "multi_hop_association" || category === "abstention" ? "hard" : "medium",
      architecture_bias_risk: category === "multi_hop_association" ? "medium" : "low",
      fairness_note: `Verifies provider-neutral evaluation for category ${category}.`
    });
  }
  
  datasetC.conversations.push({
    conversation_id: `dc_c${cNum}_${domain}`,
    agent_id: `dc_agent_${domain}_${cNum}`,
    domain: domain,
    memory_records: records,
    questions: questions
  });
}

// ----------------------------------------------------
// DATASET B: REALISTIC MEDIUM
// 20 conversations, 300 memories (15 per conv), 120 questions (6 per conv)
// ----------------------------------------------------
const datasetB = {
  name: "realistic-medium",
  description: "Stronger public memory benchmark dataset containing 20 conversations with 300 memory records and 120 questions across multiple categories.",
  generated_at: new Date().toISOString().split('T')[0],
  fairness_notes: [
    "No memory passport, decay, or graph traversal assumptions.",
    "Ensures balanced evaluation of vector and graph-based systems across 8 distinct domains."
  ],
  conversations: []
};

// Category allocation list for B: 120 questions total
// 25% atomic fact recall = 30 questions
// 20% paraphrased semantic recall = 24 questions
// 15% temporal/current preference = 18 questions
// 10% contradiction resolution = 12 questions
// 10% multi-hop association = 12 questions
// 10% noise resistance = 12 questions
// 5% procedural recall = 6 questions
// 5% abstention = 6 questions
const categoriesB = [
  ...Array(30).fill("atomic_fact_recall"),
  ...Array(24).fill("paraphrased_semantic_recall"),
  ...Array(18).fill("temporal_update"),
  ...Array(12).fill("contradiction_resolution"),
  ...Array(12).fill("multi_hop_association"),
  ...Array(12).fill("noise_resistance"),
  ...Array(6).fill("procedural_recall"),
  ...Array(6).fill("abstention")
];

const domainsB = [
  "software", "personal_assistant", "research", "travel", "health_admin", "finance_admin", "education", "creative_work",
  "software", "personal_assistant", "research", "travel", "health_admin", "finance_admin", "education", "creative_work",
  "software", "personal_assistant", "research", "travel"
];

for (let i = 0; i < 20; i++) {
  const cNum = String(i + 1).padStart(2, '0');
  const domain = domainsB[i];
  const records = [];
  const questions = [];
  
  // Create 15 memory records per conversation
  for (let j = 1; j <= 15; j++) {
    const mId = `db_c${cNum}_m${String(j).padStart(2, '0')}`;
    let content = "";
    let type = "semantic";
    let tags = [domain];
    let importance = 0.8;
    let associations = [];
    
    if (j === 1) {
      content = `The active agent ID for ${domain} projects is designated as Agent-${cNum}.`;
      tags.push("agent-id");
    } else if (j === 2) {
      content = `The primary key indicator of success for the ${domain} task is achieving 95% accuracy.`;
      tags.push("success-metric");
    } else if (j === 3) {
      content = `The main supervisor for this ${domain} work stream is Mr. Arthur Pendelton.`;
      tags.push("supervisor");
    } else if (j === 4) {
      content = `The older instruction stated that files should be uploaded every 4 hours.`;
      tags.push("upload");
    } else if (j === 5) {
      content = `On June 15, the upload schedule was updated to every 1 hour to prevent data loss.`;
      tags.push("upload");
    } else if (j === 6) {
      content = `To register a new item in the ${domain} portal: 1. login, 2. enter ID, 3. click save.`;
      type = "procedural";
      tags.push("portal-process");
    } else if (j === 7) {
      content = `Distractor: The login button on the portal is bright orange for high visibility.`;
      tags.push("noise");
      importance = 0.2;
    } else if (j === 8) {
      content = `The supervisor Pendelton works in Office 301, located in building B.`;
      tags.push("supervisor-location");
      associations.push({ target_id: `db_c${cNum}_m03`, strength: 0.8, reason: "supervisor workplace info" });
    } else if (j === 9) {
      content = `The department code for the ${domain} work is DEPT-${cNum}.`;
      tags.push("dept-code");
    } else if (j === 10) {
      content = `The first version of the budget for DEPT-${cNum} was set to $50,000.`;
      tags.push("budget");
    } else if (j === 11) {
      content = `On June 18, the budget for DEPT-${cNum} was updated to $65,000 for expansion.`;
      tags.push("budget");
    } else if (j === 12) {
      content = `Distractor: Department DEPT-${cNum} has exactly 5 members currently.`;
      tags.push("noise");
      importance = 0.3;
    } else if (j === 13) {
      content = `The backup server hostname is backup-srv-${cNum}.local.`;
      tags.push("server");
    } else if (j === 14) {
      content = `The primary contact person for verification is Dr. Elizabeth Swan.`;
      tags.push("verifier");
    } else {
      content = `Distractor: Dr. Swan has a master's degree in ${domain} operations.`;
      tags.push("noise");
      importance = 0.2;
    }
    
    records.push({
      id: mId,
      type: type,
      timestamp: `2026-06-1${j % 9}T10:00:00Z`,
      content: content,
      tags: tags,
      importance: importance,
      metadata: { source_turn: `t${j}`, speaker: j % 2 === 0 ? "assistant" : "user" },
      associations: associations
    });
  }
  
  const startIdx = i * 6;
  const categoriesList = categoriesB.slice(startIdx, startIdx + 6);
  
  for (let q = 0; q < 6; q++) {
    const category = categoriesList[q];
    const qId = `db_c${cNum}_q${q + 1}`;
    let questionText = "";
    let expectedAnswer = "";
    let criteria = [];
    let requiredMemoryIds = [];
    let forbiddenMemoryIds = [];
    
    if (category === "atomic_fact_recall") {
      // Paraphrased: "Who oversees the operations for..."
      questionText = `Who oversees the operations for the ${domain} group?`;
      expectedAnswer = `Mr. Arthur Pendelton`;
      criteria = ["Arthur Pendelton", "Mr. Pendelton"];
      requiredMemoryIds = [`db_c${cNum}_m03`];
    } else if (category === "paraphrased_semantic_recall") {
      // Paraphrased: "What level of precision is expected..."
      questionText = `What level of precision is expected to satisfy the metrics for the ${domain} project?`;
      expectedAnswer = `95% accuracy`;
      criteria = ["95%", "95% accuracy"];
      requiredMemoryIds = [`db_c${cNum}_m02`];
    } else if (category === "temporal_update") {
      // Paraphrased: "What is the current required interval..."
      questionText = `What is the current required interval for transmitting project data?`;
      expectedAnswer = `Every 1 hour`;
      criteria = ["every 1 hour", "1 hour", "hourly"];
      requiredMemoryIds = [`db_c${cNum}_m05`];
      forbiddenMemoryIds = [`db_c${cNum}_m04`];
    } else if (category === "contradiction_resolution") {
      // Paraphrased: "Is the initial funding amount..."
      questionText = `Is the initial funding amount of fifty thousand dollars for department DEPT-${cNum} still active?`;
      expectedAnswer = `No, the budget was updated to $65,000 on June 18.`;
      criteria = ["No, it was updated to $65,000", "$65,000", "No"];
      requiredMemoryIds = [`db_c${cNum}_m11`, `db_c${cNum}_m10`];
    } else if (category === "multi_hop_association") {
      // Paraphrased: "Find the work location details..."
      questionText = `Find the work location details (room and block) of the individual leading the ${domain} group.`;
      expectedAnswer = `Office 301, building B`;
      criteria = ["Office 301", "building B"];
      requiredMemoryIds = [`db_c${cNum}_m03`, `db_c${cNum}_m08`];
    } else if (category === "noise_resistance") {
      // Paraphrased: "Identify the remote storage network..."
      questionText = `Identify the remote storage network address designated for redundancy in ${domain}.`;
      expectedAnswer = `backup-srv-${cNum}.local`;
      criteria = [`backup-srv-${cNum}.local`];
      requiredMemoryIds = [`db_c${cNum}_m13`];
      forbiddenMemoryIds = [`db_c${cNum}_m07`, `db_c${cNum}_m12`];
    } else if (category === "procedural_recall") {
      // Paraphrased: "How can one register a new entry..."
      questionText = `How can one register a new entry using the ${domain} interface?`;
      expectedAnswer = `1. login, 2. enter ID, 3. click save`;
      criteria = ["login", "enter ID", "click save"];
      requiredMemoryIds = [`db_c${cNum}_m06`];
    } else if (category === "abstention") {
      // Paraphrased: "What is the contact phone number..."
      questionText = `What is the contact phone number for the primary verification person Dr. Swan?`;
      expectedAnswer = `not enough information`;
      criteria = ["not enough information", "unknown", "insufficient evidence"];
      requiredMemoryIds = [];
      forbiddenMemoryIds = [`db_c${cNum}_m14`];
    }
    
    questions.push({
      question_id: qId,
      category: category,
      question: questionText,
      expected_answer: expectedAnswer,
      acceptable_answer_criteria: criteria,
      required_memory_ids: requiredMemoryIds,
      forbidden_memory_ids: forbiddenMemoryIds,
      difficulty: category === "multi_hop_association" || category === "abstention" ? "hard" : "medium",
      architecture_bias_risk: category === "multi_hop_association" ? "medium" : "low",
      fairness_note: `Ensures provider-neutral evaluation for category ${category}.`
    });
  }
  
  datasetB.conversations.push({
    conversation_id: `db_c${cNum}_${domain}`,
    agent_id: `db_agent_${domain}_${cNum}`,
    domain: domain,
    memory_records: records,
    questions: questions
  });
}

// ----------------------------------------------------
// AUDIT & VALIDATION ENGINE
// ----------------------------------------------------
function auditDataset(dataset) {
  const stats = {
    total_conversations: dataset.conversations.length,
    total_memories: 0,
    total_questions: 0,
    categories: {},
    graph_heavy_count: 0,
    lexical_overlap_pct: 0,
    recency_count: 0,
    abstention_count: 0,
    exact_match_overlaps: []
  };

  const allQuestions = [];
  
  for (const conv of dataset.conversations) {
    stats.total_memories += conv.memory_records.length;
    stats.total_questions += conv.questions.length;
    
    for (const q of conv.questions) {
      allQuestions.push(q);
      stats.categories[q.category] = (stats.categories[q.category] || 0) + 1;
      
      if (q.category === 'multi_hop_association') {
        stats.graph_heavy_count++;
      }
      if (q.category === 'temporal_update' || q.category === 'contradiction_resolution') {
        stats.recency_count++;
      }
      if (q.category === 'abstention') {
        stats.abstention_count++;
      }
      
      // Calculate keyword overlap with required memories
      let maxOverlap = 0;
      for (const mId of q.required_memory_ids) {
        const mem = conv.memory_records.find(m => m.id === mId);
        if (mem) {
          const overlap = getKeywordOverlap(q.question, mem.content);
          if (overlap > maxOverlap) maxOverlap = overlap;
        }
      }
      if (maxOverlap > 0) {
        stats.exact_match_overlaps.push(maxOverlap);
      }
    }
  }

  // Exact match rate calculation (overlap > 0.5 is considered exact-keyword dominant)
  const highOverlapCount = stats.exact_match_overlaps.filter(o => o > 0.5).length;
  stats.lexical_overlap_pct = (highOverlapCount / stats.total_questions) * 100;

  return stats;
}

// Perform Audit
console.log("=== RUNNING DATASET AUDIT ===");

const auditA = auditDataset(datasetA);
const auditB = auditDataset(datasetB);
const auditC = auditDataset(datasetC);

function printAuditReport(name, audit) {
  console.log(`\nAudit Report for [${name}]:`);
  console.log(`- Conversations: ${audit.total_conversations}`);
  console.log(`- Memory Records: ${audit.total_memories}`);
  console.log(`- Questions: ${audit.total_questions}`);
  console.log(`- Category Distribution:`);
  for (const [cat, count] of Object.entries(audit.categories)) {
    const pct = ((count / audit.total_questions) * 100).toFixed(1);
    console.log(`  * ${cat}: ${count} (${pct}%)`);
  }
  console.log(`- Bias Metrics:`);
  const graphHeavyPct = (audit.graph_heavy_count / audit.total_questions) * 100;
  console.log(`  * Graph-heavy questions: ${audit.graph_heavy_count} (${graphHeavyPct.toFixed(1)}%) [Limit: <= 15%]`);
  console.log(`  * Lexical/Vector overlap dominant (>50% word overlap): ${audit.lexical_overlap_pct.toFixed(1)}% [Limit: <= 40%]`);
  console.log(`  * Recency-handling questions: ${audit.recency_count}`);
  console.log(`  * Abstention questions: ${audit.abstention_count}`);
  
  // Audits Checks
  if (graphHeavyPct > 15) {
    throw new Error(`FAIL: Graph-heavy questions exceed 15% limit in ${name}`);
  }
  if (audit.lexical_overlap_pct > 40) {
    throw new Error(`FAIL: Exact keyword overlap exceeds 40% limit in ${name}`);
  }
}

printAuditReport("Dataset A: Balanced Mini", auditA);
printAuditReport("Dataset B: Realistic Medium", auditB);
printAuditReport("Dataset C: Adversarial Memory", auditC);

console.log("\nAll audits passed successfully!");

// Write datasets to target folders
const fixturesRoot = path.resolve(__dirname);
console.log(`Writing datasets to ${fixturesRoot}...`);

function writeDataset(dirName, fileName, data) {
  const dirPath = path.join(fixturesRoot, dirName);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const filePath = path.join(dirPath, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Created: ${filePath}`);
}

writeDataset("balanced-mini", "balanced-mini.json", datasetA);
writeDataset("realistic-medium", "realistic-medium.json", datasetB);
writeDataset("adversarial-memory", "adversarial-memory.json", datasetC);

console.log("Dataset files written successfully!");

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── helpers ──────────────────────────────────────────────────────────────────
const mem = (id, type, ts, content, tags, importance, source_turn, speaker, assoc = []) => ({
  id, type, timestamp: ts, content, tags,
  importance, metadata: { source_turn, speaker }, associations: assoc,
});
const assoc = (target_id, strength, reason) => ({ target_id, strength, reason });
const q = (question_id, category, question, expected_answer, criteria, required, forbidden = [], difficulty, bias_risk, fairness_note) => ({
  question_id, category, question, expected_answer,
  acceptable_answer_criteria: criteria,
  required_memory_ids: required,
  forbidden_memory_ids: forbidden,
  difficulty, architecture_bias_risk: bias_risk, fairness_note,
});
const conv = (id, agent_id, domain, memory_records, questions) => ({ conversation_id: id, agent_id, domain, memory_records, questions });

// ─── CONVERSATIONS ─────────────────────────────────────────────────────────────

const conversations = [

  // ── C01 · Software · Maya Chen / FormFlow ─────────────────────────────────
  conv("clm-c01-software", "agent-formflow", "software", [
    mem("clm-c01-m01","semantic","2025-11-01T09:00:00Z","Maya Chen is building FormFlow, a no-code form builder SaaS, using a React frontend and a FastAPI backend with PostgreSQL as the primary database.",["formflow","tech-stack"],0.75,"t01","user"),
    mem("clm-c01-m02","semantic","2025-11-05T10:00:00Z","FormFlow's initial pricing was $29/month per workspace, with no annual-plan discount.",["formflow","pricing"],0.6,"t02","user"),
    mem("clm-c01-m03","episodic","2026-01-10T11:00:00Z","Maya raised the base price to $39/month per workspace after a competitor analysis in January 2026.",["formflow","pricing"],0.65,"t03","user",[assoc("clm-c01-m02",0.9,"supersedes original price")]),
    mem("clm-c01-m04","episodic","2026-02-01T09:00:00Z","In February 2026 Maya introduced an annual-plan discount: 20% off, bringing the annual equivalent to roughly $31/month.",["formflow","pricing"],0.7,"t04","user",[assoc("clm-c01-m03",0.85,"adds discount on top of raised price")]),
    mem("clm-c01-m05","semantic","2025-12-15T14:00:00Z","Maya hired a full-time backend engineer named Kai Nakamura to own the API layer and database migrations.",["formflow","team"],0.6,"t05","user"),
    mem("clm-c01-m06","semantic","2026-01-20T10:00:00Z","Maya also brought on a freelance frontend contractor named Kira Svensson for a 3-month engagement to build the drag-and-drop editor.",["formflow","team"],0.55,"t06","user"),
    mem("clm-c01-m07","procedural","2026-02-10T09:00:00Z","FormFlow's release process: open a PR on GitHub, GitHub Actions runs unit and integration tests, merge to main, deploy to staging, wait 48 hours, then push to production.",["formflow","release-process"],0.7,"t07","user"),
    mem("clm-c01-m08","episodic","2026-03-04T11:00:00Z","Beta customers reported that webhook deliveries were failing intermittently, with payloads timing out after 5 seconds.",["formflow","bug"],0.65,"t08","user"),
    mem("clm-c01-m09","episodic","2026-03-05T14:00:00Z","Kai traced the webhook failures to an expired SSL certificate on the outbound webhook proxy server, not a bug in the payload logic.",["formflow","bug"],0.7,"t09","user",[assoc("clm-c01-m08",0.9,"root-cause diagnosis")]),
    mem("clm-c01-m10","episodic","2026-03-06T09:00:00Z","Kai renewed the SSL certificate and rotated the proxy server config; webhook deliveries returned to normal within the hour.",["formflow","bug"],0.65,"t10","user",[assoc("clm-c01-m09",0.9,"resolution")]),
    mem("clm-c01-m11","semantic","2026-03-15T10:00:00Z","FormFlow now supports three webhook event types: form.submitted, form.updated, and respondent.created.",["formflow","webhooks"],0.55,"t11","user"),
    mem("clm-c01-m12","semantic","2026-03-20T11:00:00Z","Distractor: Kira Svensson prefers working with Vue.js and only agreed to the React project because of the interesting domain.",["formflow","noise"],0.2,"t12","user"),
    mem("clm-c01-m13","semantic","2026-04-01T09:00:00Z","FormFlow reached 500 paying workspaces in April 2026, up from 180 at the start of the year.",["formflow","growth"],0.6,"t13","user"),
    mem("clm-c01-m14","semantic","2026-04-10T10:00:00Z","Maya's co-founder, Jordan Park, handles all customer-success and sales; Maya focuses exclusively on product.",["formflow","team"],0.55,"t14","user"),
    mem("clm-c01-m15","semantic","2026-04-15T14:00:00Z","Distractor: Jordan Park has a background in hospitality management and previously ran a boutique hotel in Cape Town.",["formflow","noise"],0.15,"t15","user"),
  ],[
    q("clm-c01-q01","atomic_fact_recall","What database does FormFlow use?","PostgreSQL",["PostgreSQL","Postgres"],["clm-c01-m01"],[],"easy","low","Single stated fact in one record."),
    q("clm-c01-q02","paraphrased_semantic_recall","Walk me through how Maya ships a new version of FormFlow.","Open a PR, CI runs tests on GitHub Actions, merge to main, deploy to staging, hold for 48 hours, then release to production.",["mentions CI","mentions 48-hour staging hold"],["clm-c01-m07"],[],"medium","low","Rephrased from the procedural memory."),
    q("clm-c01-q03","temporal_update","What is FormFlow's current monthly price for a workspace?","$39/month (or ~$31/month on the annual plan with a 20% discount).",["states $39 as base","mentions annual discount or ~$31"],["clm-c01-m04"],["clm-c01-m02"],"medium","medium","Price changed twice; must surface the most recent state."),
    q("clm-c01-q04","contradiction_resolution","Is FormFlow still priced at $29/month?","No. The price was raised to $39/month in January 2026 and an annual discount was added in February 2026.",["says no","cites $39 as current base"],["clm-c01-m03","clm-c01-m04"],["clm-c01-m02"],"medium","medium","Tests resistance to the stale original price."),
    q("clm-c01-q05","noise_resistance","Did Kai build the drag-and-drop editor?","No. Kira Svensson, the freelance frontend contractor, built the drag-and-drop editor. Kai owns the API and database layer.",["attributes editor to Kira","distinguishes Kai from Kira"],["clm-c01-m05","clm-c01-m06"],[],"hard","medium","Kai vs Kira – similar first names; tests role disambiguation."),
    q("clm-c01-q06","multi_hop","What was the root cause of the webhook timeouts reported by beta customers?","An expired SSL certificate on the outbound webhook proxy server.",["mentions expired SSL certificate","mentions proxy server"],["clm-c01-m08","clm-c01-m09"],[],"hard","low","Requires linking the symptom record to the diagnosis record."),
  ]),

  // ── C02 · Software · Raj Patel / Snapbuild CLI ─────────────────────────────
  conv("clm-c02-software", "agent-snapbuild", "software", [
    mem("clm-c02-m01","semantic","2025-10-01T09:00:00Z","Raj Patel is building Snapbuild, an open-source build-system CLI written in Go that targets Python, Node.js, and Rust projects.",["snapbuild","tech-stack"],0.75,"t01","user"),
    mem("clm-c02-m02","episodic","2026-01-15T10:00:00Z","Snapbuild v1.0 was publicly released on January 15, 2026, after six months of private beta.",["snapbuild","releases"],0.7,"t02","user"),
    mem("clm-c02-m03","episodic","2026-02-20T11:00:00Z","Snapbuild v1.1 shipped on February 20, 2026, adding intelligent dependency caching to cut rebuild times by up to 60%.",["snapbuild","releases","caching"],0.65,"t03","user",[assoc("clm-c02-m02",0.8,"incremental release")]),
    mem("clm-c02-m04","episodic","2026-03-28T09:00:00Z","Snapbuild v1.2 launched on March 28, 2026, introducing parallel builds — running up to 8 targets concurrently.",["snapbuild","releases","parallel"],0.7,"t04","user",[assoc("clm-c02-m03",0.8,"incremental release")]),
    mem("clm-c02-m05","procedural","2026-01-15T10:00:00Z","To start a new Snapbuild project: run `snapbuild init` in the project root (creates snapbuild.yaml), then `snapbuild build --target=<lang>` to execute the build.",["snapbuild","workflow"],0.7,"t05","user"),
    mem("clm-c02-m06","semantic","2026-02-01T10:00:00Z","The Snapbuild community held a vote on adding Java support; 68% voted against it, so Raj decided not to add it.",["snapbuild","java","community"],0.6,"t06","user"),
    mem("clm-c02-m07","semantic","2026-03-01T09:00:00Z","Distractor: Raj keeps a personal blog at rajpatel.dev where he posts release notes and architecture deep-dives.",["snapbuild","noise"],0.15,"t07","user"),
    mem("clm-c02-m08","semantic","2026-04-01T10:00:00Z","Snapbuild's configuration file is named snapbuild.yaml and must be placed in the project root directory.",["snapbuild","config"],0.65,"t08","user"),
    mem("clm-c02-m09","semantic","2026-04-10T11:00:00Z","Snapbuild has 3,200 GitHub stars and 140 contributors as of April 2026.",["snapbuild","community"],0.5,"t09","user"),
    mem("clm-c02-m10","semantic","2026-04-15T09:00:00Z","Distractor: Raj's favorite Go library is chi for HTTP routing, which he uses in his side projects but not in Snapbuild itself.",["snapbuild","noise"],0.1,"t10","user"),
    mem("clm-c02-m11","episodic","2026-05-01T10:00:00Z","Raj has not announced a v1.3 release date; he said publicly that the next major feature is cross-platform Docker integration, but no timeline is set.",["snapbuild","roadmap"],0.55,"t11","user"),
    mem("clm-c02-m12","semantic","2026-05-10T11:00:00Z","Snapbuild is licensed under the Apache 2.0 license.",["snapbuild","license"],0.5,"t12","user"),
    mem("clm-c02-m13","semantic","2026-05-15T09:00:00Z","Raj works full-time on Snapbuild after leaving his position at Stripe in late 2025.",["snapbuild","team"],0.5,"t13","user"),
    mem("clm-c02-m14","semantic","2026-05-20T10:00:00Z","Distractor: Snapbuild's internal codename during development was 'Piston', which Raj chose because of his love of motorsport.",["snapbuild","noise"],0.1,"t14","user"),
    mem("clm-c02-m15","semantic","2026-05-25T11:00:00Z","Snapbuild currently has no Windows support; Raj confirmed it targets Linux and macOS only.",["snapbuild","platforms"],0.6,"t15","user"),
  ],[
    q("clm-c02-q01","atomic_fact_recall","What programming language is Snapbuild written in?","Go",["Go","Golang"],["clm-c02-m01"],[],"easy","low","Single stated fact."),
    q("clm-c02-q02","procedural_recall","How do you initialise a new Snapbuild project and run a build?","Run `snapbuild init` in the project root to create snapbuild.yaml, then run `snapbuild build --target=<lang>`.",["mentions snapbuild init","mentions snapbuild build","mentions --target"],["clm-c02-m05"],[],"medium","low","Procedural recall from a single record."),
    q("clm-c02-q03","temporal_update","What is the latest version of Snapbuild and what did it add?","v1.2, released March 28 2026, which added parallel builds supporting up to 8 concurrent targets.",["states v1.2","mentions parallel builds"],["clm-c02-m04"],["clm-c02-m02","clm-c02-m03"],"medium","medium","Must surface the most recent release, not v1.0 or v1.1."),
    q("clm-c02-q04","contradiction_resolution","Did Snapbuild add Java support after the community vote?","No. 68% of community voters opposed it, so Raj decided not to add Java support.",["says no","references the community vote"],["clm-c02-m06"],[],"medium","low","Tests whether the system avoids assuming a feature was added."),
    q("clm-c02-q05","abstention","When will Snapbuild v1.3 be released?","No release date has been announced. Raj mentioned Docker integration as the next major feature but gave no timeline.",["states no date announced","mentions Docker as next feature"],["clm-c02-m11"],[],"medium","low","Information is explicitly absent; correct answer is to acknowledge uncertainty."),
    q("clm-c02-q06","noise_resistance","Does Snapbuild support Windows?","No. Snapbuild targets Linux and macOS only; Raj confirmed there is no Windows support.",["says no Windows support","Linux and macOS"],["clm-c02-m15"],[],"easy","low","Tests that the system does not conflate cross-platform Docker roadmap with current Windows support."),
  ]),

  // ── C03 · Software · Priya Sharma / NestBudget ────────────────────────────
  conv("clm-c03-software", "agent-nestbudget", "software", [
    mem("clm-c03-m01","semantic","2025-11-01T09:00:00Z","Priya Sharma is building NestBudget, a household budget app built with React Native and a Firebase backend, targeting both iOS and Android.",["nestbudget","tech-stack"],0.75,"t01","user"),
    mem("clm-c03-m02","episodic","2026-02-14T10:00:00Z","NestBudget launched on iOS first on February 14, 2026; Android was not yet available at launch.",["nestbudget","release"],0.7,"t02","user"),
    mem("clm-c03-m03","episodic","2026-04-22T11:00:00Z","The Android version of NestBudget launched on April 22, 2026, bringing parity with the iOS feature set.",["nestbudget","release"],0.65,"t03","user",[assoc("clm-c03-m02",0.85,"Android completes cross-platform launch")]),
    mem("clm-c03-m04","semantic","2026-02-14T09:00:00Z","NestBudget is free to download with a 3-month free trial; after the trial it costs $4.99/month per household.",["nestbudget","pricing"],0.7,"t04","user"),
    mem("clm-c03-m05","episodic","2026-03-10T10:00:00Z","Users reported that budget alerts were firing twice per event; Priya traced the cause to duplicate FCM tokens being registered on app re-installs.",["nestbudget","bug"],0.65,"t05","user"),
    mem("clm-c03-m06","episodic","2026-03-12T11:00:00Z","Priya patched the FCM token registration to dedup on user-ID, resolving the double-alert bug.",["nestbudget","bug"],0.6,"t06","user",[assoc("clm-c03-m05",0.9,"resolution")]),
    mem("clm-c03-m07","semantic","2026-03-20T09:00:00Z","NestBudget supports shared households: up to 5 members can link to the same budget under one subscription.",["nestbudget","features"],0.6,"t07","user"),
    mem("clm-c03-m08","semantic","2026-04-01T10:00:00Z","Distractor: Priya's co-founder left the project in December 2025 due to a personal conflict; Priya now runs the company alone.",["nestbudget","noise"],0.2,"t08","user"),
    mem("clm-c03-m09","semantic","2026-04-15T11:00:00Z","NestBudget integrates with five major Canadian banks through the Flinks API and with US banks through Plaid.",["nestbudget","integrations"],0.65,"t09","user"),
    mem("clm-c03-m10","semantic","2026-04-20T09:00:00Z","Distractor: Priya was previously a financial analyst at TD Bank for four years before pivoting to indie development.",["nestbudget","noise"],0.1,"t10","user"),
    mem("clm-c03-m11","episodic","2026-05-01T10:00:00Z","NestBudget has 8,400 active households as of May 2026, with a 62% trial-to-paid conversion rate.",["nestbudget","growth"],0.6,"t11","user"),
    mem("clm-c03-m12","semantic","2026-05-10T11:00:00Z","Priya has not announced a family-plan tier or any pricing changes; the product roadmap is focused on receipt scanning next.",["nestbudget","roadmap"],0.55,"t12","user"),
    mem("clm-c03-m13","semantic","2026-05-15T09:00:00Z","NestBudget's push notifications are powered by Firebase Cloud Messaging (FCM).",["nestbudget","infrastructure"],0.5,"t13","user"),
    mem("clm-c03-m14","semantic","2026-05-20T10:00:00Z","NestBudget's App Store rating is 4.7 stars (based on 1,200 reviews) and its Play Store rating is 4.5 stars (based on 340 reviews).",["nestbudget","ratings"],0.45,"t14","user"),
    mem("clm-c03-m15","semantic","2026-05-25T11:00:00Z","Distractor: Priya's next personal project is a meal-planning app she is prototyping in her spare time, unrelated to NestBudget.",["nestbudget","noise"],0.1,"t15","user"),
  ],[
    q("clm-c03-q01","atomic_fact_recall","Which platforms does NestBudget currently support?","Both iOS and Android. iOS launched February 14 2026; Android followed April 22 2026.",["mentions iOS","mentions Android"],["clm-c03-m02","clm-c03-m03"],[],"easy","low","Requires synthesising two records but neither requires inference."),
    q("clm-c03-q02","temporal_update","When did NestBudget become available on Android?","April 22, 2026.",["April 22","April 2026"],["clm-c03-m03"],["clm-c03-m02"],"easy","low","Requires selecting the Android-launch record."),
    q("clm-c03-q03","paraphrased_semantic_recall","What caused budget alerts to go off twice for the same event?","Duplicate FCM tokens were being registered when users re-installed the app.",["duplicate FCM tokens","re-installs"],["clm-c03-m05"],[],"medium","low","Rephrased from the bug-report memory."),
    q("clm-c03-q04","noise_resistance","Did the double-alert bug come from an error in the budget-logic code?","No. The root cause was duplicate FCM tokens registered during app re-installs, not a fault in the budget logic.",["says no","FCM tokens"],["clm-c03-m05"],[],"medium","low","Tests that the system identifies the actual root cause rather than a plausible but wrong guess."),
    q("clm-c03-q05","abstention","Has Priya announced a family-plan pricing tier?","No. The roadmap is focused on receipt scanning; no family plan or pricing change has been announced.",["states no announcement","mentions receipt scanning as next priority"],["clm-c03-m12"],[],"medium","low","Correct answer is acknowledging absence of announced plans."),
    q("clm-c03-q06","atomic_fact_recall","What is NestBudget's monthly subscription price after the free trial?","$4.99/month per household.",["$4.99","4.99"],["clm-c03-m04"],[],"easy","low","Single directly-stated fact."),
  ]),

  // ── C04 · Personal Assistant · Soren Lindqvist / executive scheduling ──────
  conv("clm-c04-personal_assistant", "agent-pa-soren", "personal_assistant", [
    mem("clm-c04-m01","semantic","2025-09-01T08:00:00Z","Soren Lindqvist is a managing partner at Nordic Apex Consulting, based in Stockholm, and frequently travels to Dubai and Tokyo for client work.",["soren","travel"],0.7,"t01","user"),
    mem("clm-c04-m02","semantic","2025-09-05T09:00:00Z","Soren's team standup was originally scheduled every Monday at 9:00 AM Stockholm time.",["soren","standup"],0.6,"t02","user"),
    mem("clm-c04-m03","episodic","2026-01-15T10:00:00Z","After team feedback that Mondays were too hectic for a standup, Soren moved the weekly standup to Tuesdays at 9:00 AM Stockholm time, starting February 2026.",["soren","standup"],0.65,"t03","user",[assoc("clm-c04-m02",0.9,"replaces Monday standup")]),
    mem("clm-c04-m04","semantic","2026-03-01T09:00:00Z","Soren's wedding anniversary is September 14. He wants to book dinner at Oaxen Krog in Stockholm for that evening.",["soren","personal"],0.7,"t04","user"),
    mem("clm-c04-m05","semantic","2026-03-10T10:00:00Z","For airport transfers in Stockholm, Soren exclusively uses Cabonline and refuses to use Uber due to a past poor experience.",["soren","travel","preferences"],0.65,"t05","user"),
    mem("clm-c04-m06","episodic","2026-04-01T11:00:00Z","Soren has a board meeting at Nordic Apex on September 15, the day after his anniversary. He has not yet resolved the scheduling conflict with a personal trip planned that same week.",["soren","conflict"],0.6,"t06","user"),
    mem("clm-c04-m07","semantic","2026-04-10T09:00:00Z","Soren's direct assistant is Ida Bergström, who manages his calendar and expenses.",["soren","team"],0.55,"t07","user"),
    mem("clm-c04-m08","semantic","2026-04-15T10:00:00Z","Distractor: Soren holds an MBA from Stockholm School of Economics and occasionally lectures there on leadership strategy.",["soren","noise"],0.1,"t08","user"),
    mem("clm-c04-m09","semantic","2026-04-20T11:00:00Z","Soren's preferred hotel chain in Tokyo is Aman; in Dubai he stays at the Four Seasons DIFC.",["soren","travel","preferences"],0.55,"t09","user"),
    mem("clm-c04-m10","semantic","2026-04-25T09:00:00Z","Soren always requests a window seat, economy plus or business class minimum, on flights longer than 4 hours.",["soren","travel","preferences"],0.5,"t10","user"),
    mem("clm-c04-m11","semantic","2026-05-01T10:00:00Z","Distractor: Soren's favourite restaurant in Tokyo is Sukiyabashi Jiro Honten, though he has never actually been able to get a reservation.",["soren","noise"],0.1,"t11","user"),
    mem("clm-c04-m12","semantic","2026-05-10T11:00:00Z","Soren does not use Slack; all team communication goes through Microsoft Teams.",["soren","comms"],0.5,"t12","user"),
    mem("clm-c04-m13","semantic","2026-05-15T09:00:00Z","Soren's next confirmed travel is a Dubai trip departing June 8, 2026, for a three-day client workshop.",["soren","travel"],0.6,"t13","user"),
    mem("clm-c04-m14","semantic","2026-05-20T10:00:00Z","Distractor: Ida Bergström has been Soren's assistant for 6 years and previously worked at Volvo Cars.",["soren","noise"],0.1,"t14","user"),
    mem("clm-c04-m15","semantic","2026-05-25T11:00:00Z","Soren has not yet decided how to resolve the September 15 board-meeting conflict; he is waiting for updated client availability before committing to a change.",["soren","conflict"],0.55,"t15","user",[assoc("clm-c04-m06",0.8,"still unresolved")]),
  ],[
    q("clm-c04-q01","atomic_fact_recall","Which car service does Soren use for airport transfers in Stockholm?","Cabonline.",["Cabonline"],["clm-c04-m05"],[],"easy","low","Single stated preference."),
    q("clm-c04-q02","temporal_update","What day is Soren's weekly standup now held?","Tuesdays at 9:00 AM Stockholm time (moved from Mondays in February 2026).",["Tuesday","Tuesdays"],["clm-c04-m03"],["clm-c04-m02"],"easy","medium","Must return the updated day, not the original Monday."),
    q("clm-c04-q03","contradiction_resolution","Is Soren's team standup on Mondays?","No. It was moved to Tuesdays at 9:00 AM starting February 2026 after team feedback.",["says no","Tuesday"],["clm-c04-m03"],["clm-c04-m02"],"medium","medium","Tests resistance to the now-stale Monday schedule."),
    q("clm-c04-q04","paraphrased_semantic_recall","Where does Soren plan to take his partner for their anniversary dinner?","Oaxen Krog in Stockholm, on the evening of September 14.",["Oaxen Krog","September 14"],["clm-c04-m04"],[],"medium","low","Rephrased from the preference record."),
    q("clm-c04-q05","abstention","Has Soren resolved the scheduling conflict between his September 15 board meeting and his personal trip?","No. He is still waiting for updated client availability before deciding.",["states unresolved","waiting for client availability"],["clm-c04-m15"],[],"medium","low","Correctly abstains from inventing a resolution."),
    q("clm-c04-q06","noise_resistance","Does Soren use Uber for airport transfers?","No. Soren refuses to use Uber and exclusively uses Cabonline due to a past poor experience.",["says no","Cabonline"],["clm-c04-m05"],[],"easy","low","Tests rejection of a plausible but wrong answer."),
  ]),

  // ── C05 · Personal Assistant · Amara Diallo / fitness & health ────────────
  conv("clm-c05-personal_assistant", "agent-pa-amara", "personal_assistant", [
    mem("clm-c05-m01","semantic","2025-12-01T08:00:00Z","Amara Diallo's goal is to complete a half-marathon in September 2026; she started structured training in December 2025.",["amara","fitness","goal"],0.75,"t01","user"),
    mem("clm-c05-m02","semantic","2026-01-10T09:00:00Z","Amara's training plan calls for 4 running days and 2 strength sessions per week, with one full rest day.",["amara","training"],0.7,"t02","user"),
    mem("clm-c05-m03","semantic","2025-12-15T10:00:00Z","Amara is pescatarian and has a shellfish allergy — she avoids shrimp, crab, lobster, and clams.",["amara","diet"],0.75,"t03","user"),
    mem("clm-c05-m04","episodic","2025-11-20T11:00:00Z","Amara's 5K personal best was 28:15 as of November 2025.",["amara","pb"],0.65,"t04","user"),
    mem("clm-c05-m05","episodic","2026-05-10T09:00:00Z","By May 2026, Amara improved her 5K personal best to 26:40 after six months of structured training.",["amara","pb"],0.7,"t05","user",[assoc("clm-c05-m04",0.9,"supersedes earlier PB")]),
    mem("clm-c05-m06","semantic","2026-01-05T10:00:00Z","Amara trains with Coach Yuki Nakamura at Velocity Athletics in Toronto.",["amara","coach"],0.6,"t06","user"),
    mem("clm-c05-m07","episodic","2026-04-15T11:00:00Z","Amara's sports medicine doctor cleared her for high-intensity interval training in April 2026 following a knee assessment.",["amara","medical"],0.65,"t07","user"),
    mem("clm-c05-m08","semantic","2026-04-20T09:00:00Z","Distractor: Velocity Athletics sponsors a local 10K race every spring; Amara volunteered at last year's event.",["amara","noise"],0.1,"t08","user"),
    mem("clm-c05-m09","semantic","2026-05-01T10:00:00Z","Amara tracks her sleep with a Garmin Forerunner and logs her nutrition in Cronometer.",["amara","tracking"],0.5,"t09","user"),
    mem("clm-c05-m10","semantic","2026-05-05T11:00:00Z","Amara does not currently take any supplements; her doctor advised against protein powder given her kidney health history.",["amara","supplements"],0.6,"t10","user"),
    mem("clm-c05-m11","semantic","2026-05-15T09:00:00Z","Distractor: Amara's half-marathon target race is the Scotiabank Toronto Waterfront Half, but she has not yet registered.",["amara","noise"],0.15,"t11","user"),
    mem("clm-c05-m12","semantic","2026-05-20T10:00:00Z","Amara's long run is scheduled every Sunday morning; she currently peaks at 18 km for her long-run distance.",["amara","training"],0.55,"t12","user"),
    mem("clm-c05-m13","semantic","2026-05-25T11:00:00Z","Yuki Nakamura (Amara's coach) is not the same person as Yuki Tanaka, a fine-art photographer in Chicago.",["amara","disambiguation"],0.4,"t13","user"),
    mem("clm-c05-m14","semantic","2026-06-01T09:00:00Z","Amara has decided she will not use a pacers group for the half-marathon; she prefers to race by effort.",["amara","race-strategy"],0.45,"t14","user"),
    mem("clm-c05-m15","semantic","2026-06-05T10:00:00Z","Distractor: Amara studied sports science at Ryerson University before switching to a career in marketing.",["amara","noise"],0.1,"t15","user"),
  ],[
    q("clm-c05-q01","atomic_fact_recall","What is Amara's dietary restriction beyond being pescatarian?","She has a shellfish allergy — she avoids shrimp, crab, lobster, and clams.",["shellfish allergy","shrimp","crab"],["clm-c05-m03"],[],"easy","low","Single stated fact with specifics."),
    q("clm-c05-q02","paraphrased_semantic_recall","How many days per week does Amara currently run, and how many days does she do strength work?","She runs 4 days a week and does 2 strength sessions, with one rest day.",["4 days running","2 strength"],["clm-c05-m02"],[],"medium","low","Rephrased from the training-plan record."),
    q("clm-c05-q03","temporal_update","What is Amara's current 5K personal best?","26:40, achieved by May 2026.",["26:40"],["clm-c05-m05"],["clm-c05-m04"],"easy","medium","Must surface the improved PB, not the original 28:15."),
    q("clm-c05-q04","contradiction_resolution","Is Amara's 5K PB still 28:15?","No. She improved it to 26:40 after six months of structured training (as of May 2026).",["says no","26:40"],["clm-c05-m05"],["clm-c05-m04"],"medium","medium","Tests resistance to the outdated PB figure."),
    q("clm-c05-q05","noise_resistance","Is Coach Yuki Nakamura a photographer based in Chicago?","No. Coach Yuki Nakamura is Amara's running coach at Velocity Athletics in Toronto. Yuki Tanaka is a separate person — a fine-art photographer in Chicago.",["says no","distinguishes Yuki Nakamura from Yuki Tanaka","Toronto"],["clm-c05-m06","clm-c05-m13"],[],"hard","medium","Near-duplicate name trap: Yuki Nakamura vs Yuki Tanaka."),
    q("clm-c05-q06","atomic_fact_recall","Who is Amara's coach and where does she train?","Coach Yuki Nakamura at Velocity Athletics in Toronto.",["Yuki Nakamura","Velocity Athletics","Toronto"],["clm-c05-m06"],[],"easy","low","Direct fact recall."),
  ]),

  // ── C06 · Research · Dr. Chidi Okonkwo / neuroscience study ───────────────
  conv("clm-c06-research", "agent-research-chidi", "research", [
    mem("clm-c06-m01","semantic","2025-06-01T09:00:00Z","Dr. Chidi Okonkwo is a neuroscience researcher at Northwestern University studying cognitive load in bilingual speakers, funded by an NIH R01 grant.",["chidi","study","funding"],0.8,"t01","user"),
    mem("clm-c06-m02","semantic","2025-08-01T10:00:00Z","The original study enrolled 60 participants divided into a bilingual group (30) and a monolingual control group (30).",["chidi","participants"],0.7,"t02","user"),
    mem("clm-c06-m03","episodic","2026-03-15T11:00:00Z","In March 2026, Dr. Okonkwo expanded the sample to 90 participants (45 bilingual, 45 monolingual) after receiving a no-cost extension on the grant.",["chidi","participants"],0.75,"t03","user",[assoc("clm-c06-m02",0.9,"expands original sample")]),
    mem("clm-c06-m04","semantic","2025-08-01T09:00:00Z","The primary measure is response latency (in milliseconds) on a colour-word Stroop task administered on a laptop.",["chidi","methodology"],0.7,"t04","user"),
    mem("clm-c06-m05","semantic","2026-04-01T10:00:00Z","The key finding so far: the bilingual group showed 12% faster language-switch costs than the monolingual group on the Stroop task.",["chidi","findings"],0.8,"t05","user"),
    mem("clm-c06-m06","semantic","2026-01-10T11:00:00Z","Dr. Priya Mehta at the University of Toronto is the co-author who handles all statistical analysis and data modelling.",["chidi","team"],0.65,"t06","user"),
    mem("clm-c06-m07","episodic","2026-04-20T09:00:00Z","The manuscript was submitted to Nature Neuroscience in April 2026 and is currently under peer review.",["chidi","publication"],0.7,"t07","user"),
    mem("clm-c06-m08","semantic","2026-05-01T10:00:00Z","The study's IRB approval from Northwestern's IRB board expires December 31, 2026.",["chidi","irb"],0.65,"t08","user"),
    mem("clm-c06-m09","semantic","2026-05-10T11:00:00Z","Distractor: Dr. Okonkwo also runs a lab for undergraduate research assistants and supervises two PhD students.",["chidi","noise"],0.1,"t09","user"),
    mem("clm-c06-m10","semantic","2026-05-15T09:00:00Z","Distractor: Dr. Okonkwo grew up in Lagos and moved to the United States for his doctoral work at Johns Hopkins.",["chidi","noise"],0.1,"t10","user"),
    mem("clm-c06-m11","semantic","2026-05-20T10:00:00Z","The study's secondary measure is pupil dilation captured with a Tobii eye tracker to serve as a physiological proxy for cognitive load.",["chidi","methodology"],0.6,"t11","user"),
    mem("clm-c06-m12","semantic","2026-05-25T11:00:00Z","Dr. Okonkwo has not yet decided whether to resubmit to PNAS if Nature Neuroscience declines the paper.",["chidi","roadmap"],0.5,"t12","user"),
    mem("clm-c06-m13","semantic","2026-06-01T09:00:00Z","All data are stored in a de-identified format on a HIPAA-compliant REDCap server at Northwestern.",["chidi","data-management"],0.6,"t13","user"),
    mem("clm-c06-m14","semantic","2026-06-05T10:00:00Z","The NIH R01 grant covers a 5-year project period from 2023 to 2028.",["chidi","funding"],0.6,"t14","user"),
    mem("clm-c06-m15","semantic","2026-06-10T11:00:00Z","Distractor: Dr. Mehta and Dr. Okonkwo met at a conference in Vienna in 2021 and have collaborated on two previous papers.",["chidi","noise"],0.1,"t15","user"),
  ],[
    q("clm-c06-q01","atomic_fact_recall","What is the primary task used to measure cognitive load in Dr. Okonkwo's study?","The colour-word Stroop task, measuring response latency in milliseconds.",["Stroop task","response latency"],["clm-c06-m04"],[],"easy","low","Single stated methodological fact."),
    q("clm-c06-q02","temporal_update","How many participants are currently enrolled in the study?","90 participants — 45 bilingual and 45 monolingual — after the sample was expanded in March 2026.",["90","45 bilingual","45 monolingual"],["clm-c06-m03"],["clm-c06-m02"],"medium","medium","Must surface the expanded count, not the original 60."),
    q("clm-c06-q03","contradiction_resolution","Did the study originally start with 90 participants?","No. The study started with 60 participants and was expanded to 90 in March 2026 after a no-cost grant extension.",["says no","60 originally","expanded to 90"],["clm-c06-m02","clm-c06-m03"],[],"medium","medium","Tests resistance to confusing original and expanded enrollment."),
    q("clm-c06-q04","paraphrased_semantic_recall","What was the most notable result from the Stroop task so far?","Bilingual speakers showed 12% faster language-switch costs compared to the monolingual group.",["12%","bilingual","faster switch costs"],["clm-c06-m05"],[],"medium","low","Rephrased from the findings record."),
    q("clm-c06-q05","abstention","Has the paper been accepted by Nature Neuroscience?","Not yet. It was submitted in April 2026 and is currently under peer review; no decision has been reported.",["under review","no decision","not yet accepted"],["clm-c06-m07"],[],"medium","low","Correctly abstains from implying acceptance."),
    q("clm-c06-q06","multi_hop","Who handles data analysis for Dr. Okonkwo's study, and where is that person based?","Dr. Priya Mehta handles all statistical analysis and modelling; she is based at the University of Toronto.",["Priya Mehta","University of Toronto"],["clm-c06-m06"],[],"medium","low","Two-step: identify co-author role, then their institution."),
  ]),

  // ── C07 · Research · Elena Vasquez / coastal erosion study ────────────────
  conv("clm-c07-research", "agent-research-elena", "research", [
    mem("clm-c07-m01","semantic","2025-05-01T09:00:00Z","Dr. Elena Vasquez is a climate scientist at Texas A&M University leading a coastal erosion modelling project focused on the Gulf of Mexico coastline.",["elena","study"],0.8,"t01","user"),
    mem("clm-c07-m02","semantic","2025-05-10T10:00:00Z","The project uses the COAWST (Coupled Ocean Atmosphere Wave Sediment Transport) model coupled with ADCIRC for storm-surge simulation.",["elena","model"],0.75,"t02","user"),
    mem("clm-c07-m03","semantic","2025-07-01T11:00:00Z","The original project budget was approved at $180,000 covering two years of fieldwork, computing time, and personnel.",["elena","budget"],0.7,"t03","user"),
    mem("clm-c07-m04","episodic","2026-02-01T09:00:00Z","Following an unexpectedly active 2025 storm season, the budget was revised upward to $220,000 to cover additional fieldwork and model runs.",["elena","budget"],0.75,"t04","user",[assoc("clm-c07-m03",0.9,"supersedes original budget")]),
    mem("clm-c07-m05","episodic","2026-03-12T10:00:00Z","Fieldwork was conducted at Padre Island National Seashore in March 2026; the team collected sediment cores and deployed wave-pressure sensors.",["elena","fieldwork"],0.7,"t05","user"),
    mem("clm-c07-m06","procedural","2026-03-15T11:00:00Z","The sediment core processing protocol: cores are sliced at 1 cm intervals, labelled, photographed, then shipped to the geology lab at Texas A&M for grain-size analysis.",["elena","protocol"],0.65,"t06","user"),
    mem("clm-c07-m07","semantic","2026-04-01T09:00:00Z","Dr. Vasquez submitted a manuscript to Journal of Geophysical Research – Oceans in April 2026.",["elena","publication"],0.65,"t07","user"),
    mem("clm-c07-m08","semantic","2026-04-10T10:00:00Z","Distractor: Elena's favourite beach is in Tulum, Mexico, though she notes that its erosion patterns are outside her current research scope.",["elena","noise"],0.05,"t08","user"),
    mem("clm-c07-m09","semantic","2026-04-15T11:00:00Z","The project is co-funded by NOAA's Coastal Resilience Program and the Texas Sea Grant.",["elena","funding"],0.65,"t09","user"),
    mem("clm-c07-m10","semantic","2026-04-20T09:00:00Z","Distractor: Dr. Vasquez completed her postdoctoral fellowship at Woods Hole Oceanographic Institution before joining Texas A&M.",["elena","noise"],0.05,"t10","user"),
    mem("clm-c07-m11","semantic","2026-05-01T10:00:00Z","The modelling team is a 4-person group: Elena leads, two PhD students handle model runs, and a GIS specialist processes satellite imagery.",["elena","team"],0.6,"t11","user"),
    mem("clm-c07-m12","semantic","2026-05-10T11:00:00Z","Key preliminary result: average shoreline retreat rates at the study sites averaged 1.8 m/year over the last decade.",["elena","findings"],0.75,"t12","user"),
    mem("clm-c07-m13","semantic","2026-05-15T09:00:00Z","Elena has not announced whether the study will be extended beyond its current two-year period.",["elena","roadmap"],0.5,"t13","user"),
    mem("clm-c07-m14","semantic","2026-05-20T10:00:00Z","All field data are archived in the NOAA Environmental Data Management system under project ID GOM-2025-CE.",["elena","data-management"],0.6,"t14","user"),
    mem("clm-c07-m15","semantic","2026-05-25T11:00:00Z","Distractor: Elena presented preliminary results at the AGU Fall Meeting in December 2025 and received positive feedback.",["elena","noise"],0.1,"t15","user"),
  ],[
    q("clm-c07-q01","atomic_fact_recall","What modelling tools does Elena's team use for the coastal erosion project?","COAWST coupled with ADCIRC for storm-surge simulation.",["COAWST","ADCIRC"],["clm-c07-m02"],[],"easy","low","Directly stated technical fact."),
    q("clm-c07-q02","temporal_update","What is the current project budget?","$220,000 — revised up from the original $180,000 after the active 2025 storm season.",["$220,000","220,000"],["clm-c07-m04"],["clm-c07-m03"],"medium","medium","Must surface the revised budget, not the original."),
    q("clm-c07-q03","contradiction_resolution","Was the project always budgeted at $220,000?","No. The original budget was $180,000; it was revised to $220,000 in February 2026 following an active storm season.",["says no","$180,000 originally","revised to $220,000"],["clm-c07-m03","clm-c07-m04"],[],"medium","medium","Tests resistance to the current figure being treated as the original."),
    q("clm-c07-q04","paraphrased_semantic_recall","What did the team collect during fieldwork at Padre Island?","Sediment cores and wave-pressure sensors data.",["sediment cores","wave-pressure sensors"],["clm-c07-m05"],[],"medium","low","Rephrased from the fieldwork record."),
    q("clm-c07-q05","procedural_recall","Describe the protocol for processing sediment cores from the field.","Slice cores at 1 cm intervals, label and photograph each slice, then ship to the Texas A&M geology lab for grain-size analysis.",["1 cm intervals","label","photograph","grain-size analysis"],["clm-c07-m06"],[],"medium","low","Direct procedural recall."),
    q("clm-c07-q06","abstention","Will the study be extended beyond its two-year period?","No announcement has been made; Elena has not stated whether an extension is planned.",["no announcement","not decided"],["clm-c07-m13"],[],"medium","low","Correct answer acknowledges the absence of information."),
  ]),

  // ── C08 · Healthcare · James Ortega / Type 2 diabetes management ──────────
  conv("clm-c08-healthcare", "agent-health-james", "healthcare", [
    mem("clm-c08-m01","semantic","2026-01-05T08:00:00Z","James Ortega, 52, was diagnosed with Type 2 diabetes three years ago and is managed by Dr. Rivera at Valley Medical Center.",["james","diabetes","care"],0.8,"t01","user"),
    mem("clm-c08-m02","episodic","2026-01-10T09:00:00Z","James's HbA1c in January 2026 was 8.2%, indicating suboptimal glucose control.",["james","hba1c"],0.75,"t02","user"),
    mem("clm-c08-m03","episodic","2026-05-15T10:00:00Z","At his May 2026 check-up, James's HbA1c had improved to 7.1%, now within the target range set by Dr. Rivera.",["james","hba1c"],0.8,"t03","user",[assoc("clm-c08-m02",0.95,"supersedes January reading")]),
    mem("clm-c08-m04","semantic","2026-01-10T11:00:00Z","James started on Metformin 500 mg twice daily in January 2026.",["james","medication"],0.75,"t04","user"),
    mem("clm-c08-m05","episodic","2026-03-20T09:00:00Z","Dr. Rivera increased James's Metformin dose to 1,000 mg twice daily in March 2026 when mid-quarter readings remained high.",["james","medication"],0.8,"t05","user",[assoc("clm-c08-m04",0.9,"dose increase")]),
    mem("clm-c08-m06","episodic","2026-04-01T10:00:00Z","Starting April 2026, James began 30-minute walks five times per week as part of a lifestyle modification plan.",["james","exercise"],0.7,"t06","user"),
    mem("clm-c08-m07","semantic","2026-04-05T11:00:00Z","James reduced his carbohydrate intake and eliminated sugary beverages entirely in April 2026.",["james","diet"],0.7,"t07","user"),
    mem("clm-c08-m08","semantic","2026-04-10T09:00:00Z","James monitors blood glucose with a Contour Next One glucometer; his post-meal target is below 140 mg/dL.",["james","monitoring"],0.65,"t08","user"),
    mem("clm-c08-m09","semantic","2026-05-01T10:00:00Z","Distractor: James works as an electrician and his shift pattern — early starts and packed lunches — was identified as a barrier to dietary change.",["james","noise"],0.15,"t09","user"),
    mem("clm-c08-m10","semantic","2026-05-10T11:00:00Z","James has no known drug allergies and tolerates Metformin without gastrointestinal side effects.",["james","medication","allergies"],0.6,"t10","user"),
    mem("clm-c08-m11","semantic","2026-05-15T09:00:00Z","Dr. Rivera has not yet recommended adding a GLP-1 agonist; she plans to reassess at the August 2026 visit if HbA1c stalls.",["james","roadmap"],0.65,"t11","user"),
    mem("clm-c08-m12","semantic","2026-05-20T10:00:00Z","Distractor: James's wife, Carmen, is a registered nurse and helps him track his glucose logs.",["james","noise"],0.1,"t12","user"),
    mem("clm-c08-m13","semantic","2026-06-01T09:00:00Z","James's next clinic appointment is scheduled for August 18, 2026.",["james","appointments"],0.55,"t13","user"),
    mem("clm-c08-m14","semantic","2026-06-05T10:00:00Z","James's blood pressure at the May visit was 128/82 mmHg — borderline but not yet requiring medication.",["james","vitals"],0.6,"t14","user"),
    mem("clm-c08-m15","semantic","2026-06-10T11:00:00Z","Distractor: James is also receiving care for a rotator-cuff injury from a separate orthopaedic surgeon, unrelated to his diabetes management.",["james","noise"],0.1,"t15","user"),
  ],[
    q("clm-c08-q01","temporal_update","What is James's most recent HbA1c reading?","7.1%, measured in May 2026 — improved from 8.2% in January.",["7.1%","May 2026"],["clm-c08-m03"],["clm-c08-m02"],"easy","medium","Must return the May reading, not the January one."),
    q("clm-c08-q02","temporal_update","What is James's current Metformin dose?","1,000 mg twice daily — increased from 500 mg in March 2026.",["1,000 mg","1000 mg"],["clm-c08-m05"],["clm-c08-m04"],"easy","medium","Must return the increased dose."),
    q("clm-c08-q03","paraphrased_semantic_recall","What exercise routine did James adopt as part of his lifestyle plan?","30-minute walks five times per week, starting in April 2026.",["30 minutes","five times per week","walks"],["clm-c08-m06"],[],"easy","low","Rephrased from the exercise record."),
    q("clm-c08-q04","contradiction_resolution","Is James's HbA1c still at 8.2%?","No. It improved to 7.1% by May 2026 following medication adjustment, dietary changes, and added exercise.",["says no","7.1%"],["clm-c08-m03"],["clm-c08-m02"],"medium","medium","Tests resistance to the outdated January reading."),
    q("clm-c08-q05","multi_hop","What combination of changes contributed to James's HbA1c improvement from January to May 2026?","Three changes: Metformin dose was increased to 1,000 mg twice daily (March), he added 30-minute walks five times per week (April), and he reduced carbs and cut sugary drinks (April).",["Metformin increase","exercise","diet changes"],["clm-c08-m05","clm-c08-m06","clm-c08-m07"],[],"hard","low","Requires synthesising three separate change records."),
    q("clm-c08-q06","abstention","Has Dr. Rivera recommended adding a GLP-1 agonist to James's treatment?","Not yet. She plans to reassess at the August 2026 visit if HbA1c stalls, but has made no current recommendation.",["not yet","no recommendation","reassess August"],["clm-c08-m11"],[],"medium","low","Correctly abstains from inventing a treatment decision."),
  ]),

  // ── C09 · Healthcare · Leila Nazari / mental health therapy ───────────────
  conv("clm-c09-healthcare", "agent-health-leila", "healthcare", [
    mem("clm-c09-m01","semantic","2025-10-01T09:00:00Z","Leila Nazari, 34, began therapy with Dr. Sandra Bloom, a CBT-focused psychologist, in October 2025, primarily for social anxiety.",["leila","therapy"],0.8,"t01","user"),
    mem("clm-c09-m02","semantic","2025-10-01T10:00:00Z","Leila's initial session frequency was weekly — every Thursday afternoon.",["leila","sessions"],0.7,"t02","user"),
    mem("clm-c09-m03","episodic","2026-05-01T11:00:00Z","In May 2026, Leila and Dr. Bloom agreed to move to biweekly sessions (once every two weeks) as Leila had made significant progress.",["leila","sessions"],0.75,"t03","user",[assoc("clm-c09-m02",0.9,"replaces weekly frequency")]),
    mem("clm-c09-m04","semantic","2025-11-01T09:00:00Z","Leila's two main challenges are social anxiety (difficulty in group settings and public speaking) and chronic sleep difficulties.",["leila","challenges"],0.75,"t04","user"),
    mem("clm-c09-m05","semantic","2026-01-10T10:00:00Z","Dr. Bloom recommended two techniques: daily journaling at bedtime and the 4-7-8 breathing method before sleep.",["leila","techniques"],0.7,"t05","user"),
    mem("clm-c09-m06","semantic","2026-02-01T11:00:00Z","Leila declined medication; she told Dr. Bloom she prefers to work on techniques only and does not want pharmacological support.",["leila","medication"],0.7,"t06","user"),
    mem("clm-c09-m07","episodic","2025-12-15T09:00:00Z","Leila's baseline average sleep was 5.2 hours per night, recorded by her Oura ring in December 2025.",["leila","sleep"],0.7,"t07","user"),
    mem("clm-c09-m08","episodic","2026-05-10T10:00:00Z","By May 2026, Leila's average sleep had improved to 6.8 hours per night according to her Oura ring.",["leila","sleep"],0.75,"t08","user",[assoc("clm-c09-m07",0.9,"improved from baseline")]),
    mem("clm-c09-m09","semantic","2026-03-01T11:00:00Z","Leila completed an 8-week mindfulness-based stress reduction (MBSR) course in addition to her CBT sessions.",["leila","mbsr"],0.6,"t09","user"),
    mem("clm-c09-m10","semantic","2026-04-01T09:00:00Z","Distractor: Dr. Bloom has a second practice location in Pasadena; Leila always attends the main office in Santa Monica.",["leila","noise"],0.1,"t10","user"),
    mem("clm-c09-m11","semantic","2026-04-15T10:00:00Z","Leila has not yet attempted a formal public-speaking exercise; she and Dr. Bloom have planned this for late 2026.",["leila","progress"],0.6,"t11","user"),
    mem("clm-c09-m12","semantic","2026-05-01T11:00:00Z","Distractor: Leila is a graphic designer who works remotely for a London-based agency.",["leila","noise"],0.1,"t12","user"),
    mem("clm-c09-m13","semantic","2026-05-15T09:00:00Z","Dr. Bloom has not recommended a referral to a psychiatrist; she considers Leila's case manageable within CBT alone.",["leila","care-plan"],0.6,"t13","user"),
    mem("clm-c09-m14","semantic","2026-06-01T10:00:00Z","Leila's next scheduled session with Dr. Bloom is June 25, 2026.",["leila","appointments"],0.5,"t14","user"),
    mem("clm-c09-m15","semantic","2026-06-05T11:00:00Z","Distractor: Leila's sister also sees a therapist, though a different practice and not CBT-based.",["leila","noise"],0.05,"t15","user"),
  ],[
    q("clm-c09-q01","atomic_fact_recall","What is the name of Leila's therapist?","Dr. Sandra Bloom.",["Sandra Bloom","Dr. Bloom"],["clm-c09-m01"],[],"easy","low","Single stated fact."),
    q("clm-c09-q02","temporal_update","How often does Leila currently attend therapy sessions?","Biweekly — once every two weeks — after moving from weekly sessions in May 2026.",["biweekly","every two weeks"],["clm-c09-m03"],["clm-c09-m02"],"easy","medium","Must return the updated frequency, not the original weekly."),
    q("clm-c09-q03","contradiction_resolution","Does Leila still attend therapy weekly?","No. She moved to biweekly sessions in May 2026 after making significant progress.",["says no","biweekly","May 2026"],["clm-c09-m03"],["clm-c09-m02"],"medium","medium","Tests resistance to the outdated weekly frequency."),
    q("clm-c09-q04","paraphrased_semantic_recall","How much has Leila's average nightly sleep improved since she started therapy?","From 5.2 hours (baseline, December 2025) to 6.8 hours (May 2026) — an increase of 1.6 hours per night.",["5.2","6.8","1.6 hours"],["clm-c09-m07","clm-c09-m08"],[],"medium","low","Requires reading both sleep records and noting the improvement."),
    q("clm-c09-q05","atomic_fact_recall","Is Leila currently taking any medication for her anxiety?","No. She declined medication and prefers to work only with therapeutic techniques.",["no medication","declined medication"],["clm-c09-m06"],[],"easy","low","Directly stated refusal; tests retrieval accuracy."),
    q("clm-c09-q06","abstention","Has Dr. Bloom referred Leila to a psychiatrist?","No. Dr. Bloom considers Leila's case manageable within CBT alone and has not recommended a psychiatric referral.",["no referral","CBT alone"],["clm-c09-m13"],[],"medium","low","Correctly abstains from inventing a referral."),
  ]),

  // ── C10 · Education · Felix Wagner / data science bootcamp ────────────────
  conv("clm-c10-education", "agent-edu-felix", "education", [
    mem("clm-c10-m01","semantic","2026-03-01T09:00:00Z","Felix Wagner is an instructor at TechForward Academy running Cohort 7 of their 16-week data science bootcamp, which started March 1, 2026.",["felix","cohort"],0.8,"t01","user"),
    mem("clm-c10-m02","semantic","2026-03-01T10:00:00Z","Cohort 7 had 22 students enrolled at the start; 4 dropped in the first two weeks, leaving 18 active students.",["felix","students"],0.75,"t02","user"),
    mem("clm-c10-m03","semantic","2026-03-01T11:00:00Z","The curriculum sequence is: Python fundamentals → pandas & data wrangling → ML basics → capstone project.",["felix","curriculum"],0.7,"t03","user"),
    mem("clm-c10-m04","semantic","2026-03-05T09:00:00Z","The bootcamp uses Canvas LMS for assignments and resources, and Zoom for live 3-hour sessions held Monday, Wednesday, and Friday.",["felix","platform"],0.65,"t04","user"),
    mem("clm-c10-m05","semantic","2026-03-10T10:00:00Z","The original assessment weighting was 50% weekly quizzes and 50% capstone project.",["felix","assessment"],0.7,"t05","user"),
    mem("clm-c10-m06","episodic","2026-04-15T11:00:00Z","Felix revised the weighting in April 2026 to 40% weekly quizzes and 60% capstone project after student feedback that quizzes were too high-stakes.",["felix","assessment"],0.75,"t06","user",[assoc("clm-c10-m05",0.9,"supersedes original weighting")]),
    mem("clm-c10-m07","procedural","2026-03-15T09:00:00Z","To submit a capstone milestone: students push their Jupyter notebook to the shared GitHub repo under their username branch, then post a 2-sentence summary in the Canvas discussion thread.",["felix","capstone-process"],0.7,"t07","user"),
    mem("clm-c10-m08","semantic","2026-05-01T10:00:00Z","Three students in Cohort 7 are currently behind schedule on the ML module; Felix has scheduled individual check-ins with each.",["felix","progress"],0.6,"t08","user"),
    mem("clm-c10-m09","semantic","2026-05-10T11:00:00Z","Distractor: Felix has a background in actuarial science and switched to data education after a career in insurance.",["felix","noise"],0.1,"t09","user"),
    mem("clm-c10-m10","semantic","2026-05-15T09:00:00Z","Cohort 7 is scheduled to end June 20, 2026, with capstone presentations on the final day.",["felix","schedule"],0.65,"t10","user"),
    mem("clm-c10-m11","semantic","2026-05-20T10:00:00Z","Distractor: TechForward Academy also runs a UX design track, which is run by a different instructor and has no crossover with Felix's bootcamp.",["felix","noise"],0.1,"t11","user"),
    mem("clm-c10-m12","semantic","2026-06-01T09:00:00Z","Felix has not yet confirmed whether Cohort 8 will begin immediately after Cohort 7 or whether there will be a break.",["felix","roadmap"],0.5,"t12","user"),
    mem("clm-c10-m13","semantic","2026-06-05T10:00:00Z","The top-performing student in Cohort 7 so far is Yemi Adeyemi, who has a perfect quiz score and submitted the first capstone draft.",["felix","students"],0.55,"t13","user"),
    mem("clm-c10-m14","semantic","2026-06-08T11:00:00Z","Distractor: Felix streams occasional live coding sessions on Twitch under the handle 'data_felix' for a general audience.",["felix","noise"],0.05,"t14","user"),
    mem("clm-c10-m15","semantic","2026-06-10T09:00:00Z","All quiz and grade data for Cohort 7 are stored in the Canvas gradebook and are not shared externally.",["felix","data"],0.5,"t15","user"),
  ],[
    q("clm-c10-q01","atomic_fact_recall","How many students are currently active in Cohort 7?","18 active students — 22 enrolled originally but 4 dropped in the first two weeks.",["18"],["clm-c10-m02"],[],"easy","low","Requires selecting the active count, which is stated explicitly."),
    q("clm-c10-q02","temporal_update","What is the current assessment weighting for Cohort 7?","40% weekly quizzes and 60% capstone — revised in April 2026 from the original 50/50 split.",["40%","60%","capstone"],["clm-c10-m06"],["clm-c10-m05"],"medium","medium","Must return the revised weighting, not the original."),
    q("clm-c10-q03","contradiction_resolution","Is the quiz-to-capstone weighting still 50/50?","No. Felix revised it to 40% quizzes and 60% capstone in April 2026 after student feedback.",["says no","40%","60%"],["clm-c10-m06"],["clm-c10-m05"],"medium","medium","Tests resistance to the outdated 50/50 split."),
    q("clm-c10-q04","paraphrased_semantic_recall","What is the order of topics covered in the bootcamp?","Python fundamentals first, then pandas and data wrangling, then ML basics, finishing with the capstone project.",["Python","pandas","ML","capstone"],["clm-c10-m03"],[],"easy","low","Rephrased sequence from the curriculum record."),
    q("clm-c10-q05","procedural_recall","How do students submit a capstone milestone?","Push the Jupyter notebook to the shared GitHub repo on their username branch, then post a 2-sentence summary in the Canvas discussion thread.",["GitHub","username branch","Canvas discussion"],["clm-c10-m07"],[],"medium","low","Direct procedural recall from one record."),
    q("clm-c10-q06","abstention","Has Felix confirmed when Cohort 8 will begin?","No. He has not yet confirmed whether Cohort 8 follows immediately or after a break.",["not confirmed","no announcement"],["clm-c10-m12"],[],"medium","low","Correct answer acknowledges absence of information."),
  ]),

  // ── C11 · Education · Maya Goldstein / PhD applications ──────────────────
  conv("clm-c11-education", "agent-edu-maya", "education", [
    mem("clm-c11-m01","semantic","2025-10-01T09:00:00Z","Maya Goldstein is applying to PhD programmes in computer science with a research focus on fairness and bias in machine learning systems.",["maya","phd","research-interest"],0.8,"t01","user"),
    mem("clm-c11-m02","semantic","2025-10-05T10:00:00Z","Maya's undergraduate GPA is 3.87 and her GRE scores are 168Q (Quantitative) and 162V (Verbal).",["maya","academics"],0.75,"t02","user"),
    mem("clm-c11-m03","semantic","2025-10-10T11:00:00Z","Maya applied to five programmes: Stanford, MIT, Berkeley, CMU, and UW (University of Washington).",["maya","applications"],0.8,"t03","user"),
    mem("clm-c11-m04","semantic","2025-11-15T09:00:00Z","Maya submitted to MIT first (deadline December 1, 2025); the remaining four were submitted December 15, 2025.",["maya","submissions"],0.7,"t04","user"),
    mem("clm-c11-m05","episodic","2026-03-15T10:00:00Z","By March 2026, Maya received offers of admission from Berkeley and UW; both offered teaching assistantships with full funding.",["maya","outcomes"],0.8,"t05","user"),
    mem("clm-c11-m06","episodic","2026-03-20T11:00:00Z","CMU placed Maya on a waitlist in March 2026; she has not yet been admitted or rejected.",["maya","outcomes"],0.7,"t06","user",[assoc("clm-c11-m05",0.6,"parallel outcome at different school")]),
    mem("clm-c11-m07","semantic","2025-11-01T09:00:00Z","Maya's potential faculty advisor of interest at Stanford is Prof. Chen Wei, whose lab focuses on algorithmic accountability.",["maya","stanford"],0.7,"t07","user"),
    mem("clm-c11-m08","semantic","2026-04-01T10:00:00Z","Distractor: Maya is currently working as a research assistant in a natural language processing lab, which differs from her primary ML fairness interest but provided useful experience.",["maya","noise"],0.15,"t08","user"),
    mem("clm-c11-m09","semantic","2026-04-10T11:00:00Z","Maya's undergraduate thesis was titled 'Measuring Intersectional Bias in Resume-Screening Algorithms' and received a departmental award.",["maya","thesis"],0.65,"t09","user"),
    mem("clm-c11-m10","semantic","2026-04-15T09:00:00Z","Maya has not yet heard back from Stanford or MIT as of April 2026.",["maya","outcomes"],0.7,"t10","user"),
    mem("clm-c11-m11","semantic","2026-05-01T10:00:00Z","Maya is leaning toward Berkeley over UW due to the strength of the fairness-in-ML research group, but has not made a final decision.",["maya","decision"],0.65,"t11","user"),
    mem("clm-c11-m12","semantic","2026-05-10T11:00:00Z","Distractor: Maya's undergraduate institution is Pomona College in California.",["maya","noise"],0.1,"t12","user"),
    mem("clm-c11-m13","semantic","2026-05-15T09:00:00Z","The decision deadline for Maya's two offers is April 15, 2026 — she has requested (and received) a one-week extension to April 22.",["maya","deadline"],0.65,"t13","user"),
    mem("clm-c11-m14","semantic","2026-05-20T10:00:00Z","Maya has not been offered funding from CMU, should they take her off the waitlist.",["maya","cmu-funding"],0.6,"t14","user"),
    mem("clm-c11-m15","semantic","2026-06-01T11:00:00Z","Distractor: Maya's roommate is also applying to graduate school, but in economics, with no connection to Maya's applications.",["maya","noise"],0.05,"t15","user"),
  ],[
    q("clm-c11-q01","atomic_fact_recall","What is Maya's primary research interest for her PhD?","Fairness and bias in machine learning systems.",["fairness","bias","machine learning"],["clm-c11-m01"],[],"easy","low","Single stated focus."),
    q("clm-c11-q02","atomic_fact_recall","Which five programmes did Maya apply to?","Stanford, MIT, Berkeley, CMU, and University of Washington.",["Stanford","MIT","Berkeley","CMU","UW"],["clm-c11-m03"],[],"easy","low","Complete list from one record."),
    q("clm-c11-q03","temporal_update","Which programmes have offered Maya admission so far?","Berkeley and UW, both with funded teaching assistantships, as of March 2026.",["Berkeley","UW"],["clm-c11-m05"],[],"medium","medium","Must surface admitted schools at this point in time."),
    q("clm-c11-q04","contradiction_resolution","Was Maya rejected by CMU?","No. CMU placed her on a waitlist in March 2026; she has not been admitted or rejected.",["says no","waitlist","not rejected"],["clm-c11-m06"],[],"medium","low","Waitlist ≠ rejection; tests precise status recall."),
    q("clm-c11-q05","paraphrased_semantic_recall","Who at Stanford does Maya most want to work with, and what does their lab focus on?","Prof. Chen Wei, whose lab focuses on algorithmic accountability.",["Chen Wei","algorithmic accountability"],["clm-c11-m07"],[],"medium","low","Rephrased from the faculty-interest record."),
    q("clm-c11-q06","abstention","Has Maya made a final decision about which programme to attend?","No. As of the records available she was leaning toward Berkeley but had not made a final decision.",["no final decision","leaning toward Berkeley"],["clm-c11-m11"],[],"medium","low","Correctly abstains from inventing a decision."),
  ]),

  // ── C12 · Finance · Marco Ferretti / investment portfolio ─────────────────
  conv("clm-c12-finance", "agent-finance-marco", "finance", [
    mem("clm-c12-m01","semantic","2026-01-05T09:00:00Z","Marco Ferretti is a retail investor with a portfolio valued at approximately $70,000 at the start of 2026.",["marco","portfolio"],0.75,"t01","user"),
    mem("clm-c12-m02","semantic","2026-01-10T10:00:00Z","In January 2026 Marco's allocation was: 30% broad-market ETFs, 45% individual tech stocks, 25% bonds.",["marco","allocation"],0.75,"t02","user"),
    mem("clm-c12-m03","episodic","2026-02-15T11:00:00Z","Marco sold his ARKK position in February 2026 at a loss to harvest the tax loss before the end of the tax year.",["marco","tax-loss"],0.7,"t03","user"),
    mem("clm-c12-m04","episodic","2026-04-10T09:00:00Z","After a tech-sector correction in Q1 2026, Marco rebalanced his portfolio in April: 40% ETFs, 35% tech stocks, 25% bonds. Portfolio value was approximately $82,000 after rebalancing.",["marco","rebalancing","allocation"],0.8,"t04","user",[assoc("clm-c12-m02",0.9,"replaces original allocation")]),
    mem("clm-c12-m05","episodic","2026-05-01T10:00:00Z","By May 2026, the portfolio had grown to $85,000 due to market recovery.",["marco","portfolio"],0.7,"t05","user",[assoc("clm-c12-m01",0.8,"updated portfolio value")]),
    mem("clm-c12-m06","semantic","2025-06-01T11:00:00Z","Marco switched his brokerage from Robinhood to Fidelity in mid-2025 for better research tools and lower margin rates.",["marco","broker"],0.7,"t06","user"),
    mem("clm-c12-m07","semantic","2026-04-15T09:00:00Z","Marco's top three individual stock holdings are MSFT, NVDA, and AMZN.",["marco","holdings"],0.65,"t07","user"),
    mem("clm-c12-m08","semantic","2026-04-20T10:00:00Z","Distractor: Marco tracks his portfolio in a custom Google Sheets dashboard he built himself, with automatic price pulls from a free API.",["marco","noise"],0.1,"t08","user"),
    mem("clm-c12-m09","semantic","2026-05-01T11:00:00Z","Marco has a target emergency fund of 6 months of expenses, which is held separately in a high-yield savings account at Marcus by Goldman Sachs.",["marco","savings"],0.6,"t09","user"),
    mem("clm-c12-m10","semantic","2026-05-10T09:00:00Z","Distractor: Marco's goal is to retire by age 55; he is currently 38.",["marco","noise"],0.1,"t10","user"),
    mem("clm-c12-m11","semantic","2026-05-15T10:00:00Z","Marco has no current plans to add cryptocurrency to his portfolio; he views it as too speculative for his risk tolerance.",["marco","crypto"],0.6,"t11","user"),
    mem("clm-c12-m12","semantic","2026-05-20T11:00:00Z","Marco contributes the maximum to his 401(k) (employee match included) and maintains a Roth IRA with a target contribution of $7,000/year.",["marco","retirement"],0.65,"t12","user"),
    mem("clm-c12-m13","semantic","2026-06-01T09:00:00Z","Distractor: Marco's financial advisor is named Paul Reeves; Marco consults him quarterly but makes all final decisions himself.",["marco","noise"],0.1,"t13","user"),
    mem("clm-c12-m14","semantic","2026-06-05T10:00:00Z","Marco has not announced any intention to change brokers again; he is satisfied with Fidelity.",["marco","broker"],0.55,"t14","user"),
    mem("clm-c12-m15","semantic","2026-06-10T11:00:00Z","Marco's bond allocation consists of a mix of US Treasury bonds and investment-grade corporate bonds held through a Vanguard ETF.",["marco","bonds"],0.55,"t15","user"),
  ],[
    q("clm-c12-q01","atomic_fact_recall","Which brokerage does Marco currently use?","Fidelity — he switched from Robinhood in mid-2025.",["Fidelity"],["clm-c12-m06"],["clm-c12-m13"],"easy","low","Single stated fact; noise record mentions a financial advisor name."),
    q("clm-c12-q02","temporal_update","What is Marco's current portfolio allocation across asset classes?","40% broad-market ETFs, 35% individual tech stocks, 25% bonds — rebalanced in April 2026.",["40%","35%","25%"],["clm-c12-m04"],["clm-c12-m02"],"medium","medium","Must surface the April rebalanced allocation, not the January one."),
    q("clm-c12-q03","contradiction_resolution","Is Marco's portfolio still split 30% ETFs, 45% tech, 25% bonds?","No. He rebalanced in April 2026 to 40% ETFs, 35% tech, 25% bonds after a tech-sector correction.",["says no","40% ETFs","35% tech"],["clm-c12-m04"],["clm-c12-m02"],"medium","medium","Tests resistance to the original January allocation."),
    q("clm-c12-q04","paraphrased_semantic_recall","Why did Marco shift money out of tech stocks in April 2026?","Because of a tech-sector correction in Q1 2026, he rebalanced to reduce tech exposure and increase ETF allocation.",["tech correction","rebalanced","reduce tech exposure"],["clm-c12-m04"],[],"medium","low","Rephrased from the rebalancing record."),
    q("clm-c12-q05","multi_hop","What is the current total value of Marco's portfolio, and how much has it grown since January 2026?","$85,000 as of May 2026, up from $70,000 in January 2026 — an increase of $15,000.",["$85,000","$70,000","$15,000"],["clm-c12-m01","clm-c12-m05"],[],"medium","low","Requires two records and simple arithmetic."),
    q("clm-c12-q06","abstention","Does Marco plan to add cryptocurrency to his portfolio?","No. Marco views cryptocurrency as too speculative for his risk tolerance and has no current plans to add it.",["no plans","too speculative","risk tolerance"],["clm-c12-m11"],[],"easy","low","Stated preference; tests accurate retrieval."),
  ]),

  // ── C13 · Finance · Aisha Rahman / NovaPay startup fundraising ────────────
  conv("clm-c13-finance", "agent-finance-aisha", "finance", [
    mem("clm-c13-m01","semantic","2024-09-01T09:00:00Z","Aisha Rahman is the CEO of NovaPay, a B2B payments startup focused on automating invoice reconciliation for mid-market firms.",["aisha","novapay"],0.8,"t01","user"),
    mem("clm-c13-m02","episodic","2024-12-01T10:00:00Z","NovaPay closed a $500,000 pre-seed round in December 2024 from friends, family, and two angel investors.",["aisha","pre-seed"],0.75,"t02","user"),
    mem("clm-c13-m03","semantic","2024-12-01T11:00:00Z","At pre-seed, the NovaPay team was 4 people: Aisha (CEO), one engineer, one designer, and one sales lead.",["aisha","team"],0.7,"t03","user"),
    mem("clm-c13-m04","semantic","2025-01-15T09:00:00Z","At pre-seed stage, NovaPay's monthly burn rate was $80,000.",["aisha","burn-rate"],0.7,"t04","user"),
    mem("clm-c13-m05","episodic","2026-02-10T10:00:00Z","NovaPay closed a $2.8 million seed round in February 2026, led by a Sequoia Scout with Techstars Ventures participating.",["aisha","seed"],0.85,"t05","user",[assoc("clm-c13-m02",0.8,"follows pre-seed")]),
    mem("clm-c13-m06","semantic","2026-02-10T11:00:00Z","NovaPay's post-money valuation at the seed round was $12 million.",["aisha","valuation"],0.75,"t06","user"),
    mem("clm-c13-m07","episodic","2026-03-01T09:00:00Z","Following the seed close, the team expanded to 8 employees: adding 2 more engineers, 1 customer-success manager, and 1 finance ops specialist.",["aisha","team"],0.75,"t07","user",[assoc("clm-c13-m03",0.9,"updated team size")]),
    mem("clm-c13-m08","episodic","2026-03-15T10:00:00Z","Post-seed, NovaPay's monthly burn rate increased to $140,000 to cover new salaries and office space.",["aisha","burn-rate"],0.75,"t08","user",[assoc("clm-c13-m04",0.9,"supersedes pre-seed burn rate")]),
    mem("clm-c13-m09","semantic","2026-04-01T11:00:00Z","At $140,000/month burn rate, the $2.8M seed gives NovaPay approximately 20 months of runway (minus the pre-seed remainder).",["aisha","runway"],0.7,"t09","user"),
    mem("clm-c13-m10","semantic","2026-04-10T09:00:00Z","Distractor: Aisha previously worked as a product manager at Stripe before founding NovaPay.",["aisha","noise"],0.1,"t10","user"),
    mem("clm-c13-m11","semantic","2026-04-15T10:00:00Z","NovaPay's first enterprise customer, Fenwick Manufacturing, signed a 12-month contract in February 2026.",["aisha","customers"],0.65,"t11","user"),
    mem("clm-c13-m12","semantic","2026-05-01T11:00:00Z","Aisha has not yet begun a Series A process; she is focused on reaching $1M ARR before starting the next fundraise.",["aisha","roadmap"],0.65,"t12","user"),
    mem("clm-c13-m13","semantic","2026-05-10T09:00:00Z","Distractor: Aisha is a graduate of MIT Sloan and was on the Forb`es 30 Under 30 list in 2023.",["aisha","noise"],0.1,"t13","user"),
    mem("clm-c13-m14","semantic","2026-05-15T10:00:00Z","NovaPay's primary product is a SaaS platform with API integrations into QuickBooks, NetSuite, and Sage.",["aisha","product"],0.65,"t14","user"),
    mem("clm-c13-m15","semantic","2026-06-01T11:00:00Z","Distractor: The Sequoia Scout who led the seed round is based in London and focuses on fintech and proptech.",["aisha","noise"],0.1,"t15","user"),
  ],[
    q("clm-c13-q01","atomic_fact_recall","Who led NovaPay's seed round?","A Sequoia Scout, with Techstars Ventures participating.",["Sequoia Scout","Techstars"],["clm-c13-m05"],[],"easy","low","Single stated fact."),
    q("clm-c13-q02","temporal_update","How many employees does NovaPay currently have?","8 employees — expanded from 4 at pre-seed after the seed close in February 2026.",["8","eight"],["clm-c13-m07"],["clm-c13-m03"],"easy","medium","Must return the post-seed count, not the original 4."),
    q("clm-c13-q03","contradiction_resolution","Is NovaPay's monthly burn rate still $80,000?","No. It increased to $140,000/month post-seed to cover new salaries and office space.",["says no","$140,000","140,000"],["clm-c13-m08"],["clm-c13-m04"],"medium","medium","Tests resistance to the pre-seed burn rate."),
    q("clm-c13-q04","paraphrased_semantic_recall","Roughly how long can NovaPay operate on its seed funding at current spending levels?","Approximately 20 months of runway at $140,000/month burn.",["20 months","runway"],["clm-c13-m09"],[],"medium","low","Rephrased from the runway calculation record."),
    q("clm-c13-q05","abstention","Has Aisha started a Series A fundraising process?","No. She is focused on reaching $1M ARR before initiating the next fundraise.",["no","not started","$1M ARR first"],["clm-c13-m12"],[],"medium","low","Correctly abstains from inventing a fundraise process."),
    q("clm-c13-q06","atomic_fact_recall","What was NovaPay's post-money valuation at the seed round?","$12 million.",["$12 million","12 million"],["clm-c13-m06"],[],"easy","low","Single stated fact."),
  ]),

  // ── C14 · Legal · Alex Thompson / freelance contract dispute ──────────────
  conv("clm-c14-legal", "agent-legal-alex", "legal", [
    mem("clm-c14-m01","semantic","2026-01-05T09:00:00Z","Alex Thompson is a freelance brand designer who entered a $12,000 contract with Meridian Studio for a full brand identity project.",["alex","contract"],0.8,"t01","user"),
    mem("clm-c14-m02","episodic","2026-02-15T10:00:00Z","Meridian Studio disputed the final deliverables, claiming the logo system and brand guidelines did not meet the contract specifications.",["alex","dispute"],0.75,"t02","user"),
    mem("clm-c14-m03","semantic","2026-02-20T11:00:00Z","Alex disputes Meridian's characterisation — he argues all deliverables were provided as specified in the statement of work.",["alex","dispute"],0.7,"t03","user",[assoc("clm-c14-m02",0.8,"opposing position")]),
    mem("clm-c14-m04","episodic","2026-03-10T09:00:00Z","Alex filed a mediation request through the American Arbitration Association (AAA) in March 2026.",["alex","mediation"],0.75,"t04","user"),
    mem("clm-c14-m05","semantic","2026-03-15T10:00:00Z","Alex retained Jennifer Osei of Wong & Partners LLP as his attorney to advise on the mediation.",["alex","attorney"],0.75,"t05","user"),
    mem("clm-c14-m06","procedural","2026-03-20T11:00:00Z","Jennifer Osei outlined the mediation process: both parties submit position statements within 14 days, a neutral mediator reviews them, then a joint session is scheduled within 30 days.",["alex","mediation-process"],0.7,"t06","user"),
    mem("clm-c14-m07","episodic","2026-05-12T09:00:00Z","The mediation concluded in May 2026 with a settlement: Meridian paid Alex $9,500 — a compromise below the original $12,000 contract value.",["alex","settlement"],0.8,"t07","user",[assoc("clm-c14-m01",0.8,"resolves contract dispute")]),
    mem("clm-c14-m08","semantic","2026-05-15T10:00:00Z","As part of the settlement, both parties signed a mutual non-disparagement agreement.",["alex","settlement"],0.65,"t08","user",[assoc("clm-c14-m07",0.9,"settlement terms")]),
    mem("clm-c14-m09","semantic","2026-05-20T11:00:00Z","Distractor: Jennifer Osei has been practicing IP and contract law for 12 years and previously worked at a Big Four firm.",["alex","noise"],0.1,"t09","user"),
    mem("clm-c14-m10","semantic","2026-05-25T09:00:00Z","Alex has since updated his standard contract template to include clearer deliverable definitions and a dispute-resolution clause.",["alex","lessons"],0.6,"t10","user"),
    mem("clm-c14-m11","semantic","2026-06-01T10:00:00Z","Distractor: Meridian Studio is a mid-sized creative agency in Portland, Oregon, with 35 employees.",["alex","noise"],0.1,"t11","user"),
    mem("clm-c14-m12","semantic","2026-06-05T11:00:00Z","Alex has not filed any additional legal actions beyond the settled mediation.",["alex","legal-status"],0.6,"t12","user"),
    mem("clm-c14-m13","semantic","2026-06-08T09:00:00Z","The $9,500 settlement payment was received by Alex on May 20, 2026.",["alex","payment"],0.6,"t13","user"),
    mem("clm-c14-m14","semantic","2026-06-10T10:00:00Z","Distractor: Alex's next project is a rebrand for a small boutique hotel in Barcelona, contracted at $8,000.",["alex","noise"],0.05,"t14","user"),
    mem("clm-c14-m15","semantic","2026-06-12T11:00:00Z","Alex has not pursued a complaint with any professional body against Meridian Studio.",["alex","legal-status"],0.5,"t15","user"),
  ],[
    q("clm-c14-q01","atomic_fact_recall","Who is Alex's attorney in the dispute with Meridian Studio?","Jennifer Osei of Wong & Partners LLP.",["Jennifer Osei","Wong & Partners"],["clm-c14-m05"],[],"easy","low","Single stated fact."),
    q("clm-c14-q02","temporal_update","How was the dispute between Alex and Meridian Studio resolved?","The mediation concluded with a settlement of $9,500, plus a mutual non-disparagement agreement, in May 2026.",["$9,500","settlement","May 2026"],["clm-c14-m07","clm-c14-m08"],[],"medium","medium","Must surface the settled outcome, not the original disputed amount."),
    q("clm-c14-q03","contradiction_resolution","Did Alex receive the full $12,000 from Meridian Studio?","No. The dispute was settled for $9,500 — less than the original contract value of $12,000.",["says no","$9,500","less than $12,000"],["clm-c14-m07"],["clm-c14-m01"],"medium","medium","Tests resistance to confusing contract value with settlement amount."),
    q("clm-c14-q04","paraphrased_semantic_recall","What was the dispute about?","Meridian Studio claimed the delivered logo system and brand guidelines did not meet contract specifications; Alex disputed this, arguing all deliverables were met.",["logo system","brand guidelines","specifications"],["clm-c14-m02","clm-c14-m03"],[],"medium","low","Requires both sides of the dispute from two records."),
    q("clm-c14-q05","procedural_recall","Describe the mediation process that Jennifer Osei outlined to Alex.","Both parties submit position statements within 14 days; a neutral mediator reviews them; then a joint session is scheduled within 30 days.",["position statements","14 days","30 days","joint session"],["clm-c14-m06"],[],"medium","low","Direct procedural recall."),
    q("clm-c14-q06","noise_resistance","Did Alex take Meridian Studio to court?","No. Alex filed a mediation request through the AAA, which concluded in a settlement. No court action was filed.",["mediation not court","AAA","no court"],["clm-c14-m04","clm-c14-m12"],[],"medium","low","Tests that the system does not conflate mediation with litigation."),
  ]),

  // ── C15 · Legal · Devon Kim / non-compete negotiation ────────────────────
  conv("clm-c15-legal", "agent-legal-devon", "legal", [
    mem("clm-c15-m01","semantic","2026-01-10T09:00:00Z","Devon Kim resigned from TechCore Industries in March 2026 after 4 years as a senior data engineer.",["devon","techcore"],0.8,"t01","user"),
    mem("clm-c15-m02","semantic","2026-01-15T10:00:00Z","Devon's employment contract with TechCore included a non-compete clause: 12 months duration, 50-mile geographic radius.",["devon","non-compete"],0.8,"t02","user"),
    mem("clm-c15-m03","episodic","2026-03-20T11:00:00Z","Devon retained employment attorney Patricia Nguyen to negotiate the non-compete terms before starting at a new employer.",["devon","attorney"],0.75,"t03","user"),
    mem("clm-c15-m04","episodic","2026-04-10T09:00:00Z","After negotiation, TechCore agreed to reduce the non-compete to 6 months duration and a 20-mile geographic radius.",["devon","non-compete"],0.8,"t04","user",[assoc("clm-c15-m02",0.9,"negotiated reduction")]),
    mem("clm-c15-m05","semantic","2026-04-15T10:00:00Z","Devon accepted an offer from DataStream Labs, located 28 miles from TechCore's main office — outside the negotiated 20-mile radius.",["devon","new-employer"],0.8,"t05","user",[assoc("clm-c15-m04",0.8,"clears the negotiated radius")]),
    mem("clm-c15-m06","semantic","2026-05-01T11:00:00Z","Devon's start date at DataStream Labs is May 15, 2026.",["devon","new-employer"],0.7,"t06","user",[assoc("clm-c15-m05",0.8,"timeline detail")]),
    mem("clm-c15-m07","semantic","2026-05-05T09:00:00Z","Distractor: DataStream Labs is a Series B company focused on real-time stream processing infrastructure.",["devon","noise"],0.1,"t07","user"),
    mem("clm-c15-m08","semantic","2026-05-08T10:00:00Z","Patricia Nguyen specialises in technology-sector employment law and has handled over 200 non-compete cases.",["devon","attorney"],0.55,"t08","user"),
    mem("clm-c15-m09","semantic","2026-05-10T11:00:00Z","Distractor: Devon has a master's degree in computer science from Georgia Tech.",["devon","noise"],0.1,"t09","user"),
    mem("clm-c15-m10","semantic","2026-05-12T09:00:00Z","Devon has not filed any complaint against TechCore; the negotiation was amicable and both parties signed a separation agreement.",["devon","legal-status"],0.65,"t10","user"),
    mem("clm-c15-m11","semantic","2026-05-15T10:00:00Z","The original 50-mile radius would have prevented Devon from working at DataStream Labs (28 miles away), but the negotiated 20-mile radius does not apply there.",["devon","non-compete"],0.75,"t11","user",[assoc("clm-c15-m04",0.9,"contextualises the negotiation outcome")]),
    mem("clm-c15-m12","semantic","2026-05-20T11:00:00Z","Distractor: TechCore Industries is headquartered in Austin, Texas, and primarily serves the oil-and-gas sector.",["devon","noise"],0.1,"t12","user"),
    mem("clm-c15-m13","semantic","2026-06-01T09:00:00Z","Devon has not yet decided whether to work in a similar technical domain at DataStream Labs or pivot to an adjacent ML-engineering role.",["devon","career"],0.5,"t13","user"),
    mem("clm-c15-m14","semantic","2026-06-05T10:00:00Z","The separation agreement Devon signed with TechCore includes a 6-month non-solicitation clause for TechCore clients.",["devon","separation"],0.65,"t14","user"),
    mem("clm-c15-m15","semantic","2026-06-10T11:00:00Z","Distractor: Patricia Nguyen's firm is Nguyen & Associates, located in Austin.",["devon","noise"],0.1,"t15","user"),
  ],[
    q("clm-c15-q01","atomic_fact_recall","What were the original non-compete terms in Devon's TechCore contract?","12 months duration and a 50-mile geographic radius.",["12 months","50 miles","50-mile"],["clm-c15-m02"],[],"easy","low","Single stated fact."),
    q("clm-c15-q02","temporal_update","What are Devon's non-compete terms after negotiation?","6 months duration and a 20-mile geographic radius — reduced from the original 12 months and 50 miles.",["6 months","20 miles","20-mile"],["clm-c15-m04"],["clm-c15-m02"],"medium","medium","Must surface the negotiated terms, not the original."),
    q("clm-c15-q03","contradiction_resolution","Is Devon's non-compete still 12 months with a 50-mile radius?","No. After negotiation with TechCore, it was reduced to 6 months and a 20-mile radius.",["says no","6 months","20 miles"],["clm-c15-m04"],["clm-c15-m02"],"medium","medium","Tests resistance to the original contract terms."),
    q("clm-c15-q04","paraphrased_semantic_recall","Who is Devon's attorney and what is their specialisation?","Patricia Nguyen, an employment attorney specialising in technology-sector non-compete cases.",["Patricia Nguyen","employment law","non-compete"],["clm-c15-m03","clm-c15-m08"],[],"medium","low","Requires two records to get name and specialisation."),
    q("clm-c15-q05","multi_hop","Why does the negotiated non-compete not block Devon from working at DataStream Labs?","DataStream Labs is 28 miles from TechCore's office, which is outside the negotiated 20-mile radius (though it would have been blocked by the original 50-mile radius).",["28 miles","outside 20-mile radius","original 50-mile would have blocked"],["clm-c15-m05","clm-c15-m11"],[],"hard","low","Requires linking the employer location, the negotiated radius, and the original radius in one answer."),
    q("clm-c15-q06","abstention","Has Devon decided what technical role to take at DataStream Labs?","No. Devon has not yet decided between staying in a similar data-engineering domain or pivoting to an ML-engineering role.",["not decided","no decision"],["clm-c15-m13"],[],"medium","low","Correctly abstains from inventing a role choice."),
  ]),

  // ── C16 · Creative · Hana Mori / debut novel ─────────────────────────────
  conv("clm-c16-creative", "agent-creative-hana", "creative", [
    mem("clm-c16-m01","semantic","2025-09-01T09:00:00Z","Hana Mori is writing her debut literary fiction novel, originally titled 'Saltwater Reckoning', set across three generations of a Japanese fishing family.",["hana","novel"],0.8,"t01","user"),
    mem("clm-c16-m02","episodic","2026-01-20T10:00:00Z","Hana changed the novel's title to 'The Weight of Salt' in January 2026, feeling the original title was too literal.",["hana","title"],0.75,"t02","user",[assoc("clm-c16-m01",0.9,"replaces original title")]),
    mem("clm-c16-m03","semantic","2026-01-20T11:00:00Z","The current word count is 72,000 words; Hana's target length is 85,000 words.",["hana","wordcount"],0.7,"t03","user"),
    mem("clm-c16-m04","semantic","2025-10-01T09:00:00Z","Hana originally wrote the novel from an omniscient third-person narrator perspective.",["hana","pov"],0.65,"t04","user"),
    mem("clm-c16-m05","episodic","2026-02-10T10:00:00Z","Hana switched to first-person perspective from Chapter 4 onward in February 2026, after her writing group said the omniscient voice felt distant.",["hana","pov"],0.7,"t05","user",[assoc("clm-c16-m04",0.9,"pov change")]),
    mem("clm-c16-m06","semantic","2026-02-15T11:00:00Z","Hana is submitting the manuscript to Callista Ray at Inkwell Management; her target deadline for the full manuscript is July 2026.",["hana","agent"],0.8,"t06","user"),
    mem("clm-c16-m07","semantic","2026-03-01T09:00:00Z","Hana writes in two-hour blocks every morning before her day job; she does not write on weekends.",["hana","process"],0.6,"t07","user"),
    mem("clm-c16-m08","semantic","2026-03-10T10:00:00Z","Distractor: Hana's writing group meets monthly and includes four other writers working in various genres.",["hana","noise"],0.1,"t08","user"),
    mem("clm-c16-m09","semantic","2026-03-20T11:00:00Z","Hana has not yet decided whether to attempt to sell foreign rights independently or to let the agent handle them.",["hana","rights"],0.5,"t09","user"),
    mem("clm-c16-m10","semantic","2026-04-01T09:00:00Z","The novel spans 1950s Hokkaido, 1980s Tokyo, and present-day London across its three narrative threads.",["hana","novel"],0.65,"t10","user"),
    mem("clm-c16-m11","semantic","2026-04-10T10:00:00Z","Distractor: Hana's day job is as a translator (Japanese–English) for a Tokyo-based publishing house.",["hana","noise"],0.1,"t11","user"),
    mem("clm-c16-m12","semantic","2026-04-20T11:00:00Z","Hana has completed a full first draft; she is currently in the second major revision pass.",["hana","progress"],0.7,"t12","user"),
    mem("clm-c16-m13","semantic","2026-05-01T09:00:00Z","Distractor: Hana's favourite novelist is Yoko Ogawa; her prose style is often compared to Ogawa's restrained lyricism.",["hana","noise"],0.05,"t13","user"),
    mem("clm-c16-m14","semantic","2026-05-10T10:00:00Z","The novel has no supernatural elements; it is firmly realist in style.",["hana","genre"],0.5,"t14","user"),
    mem("clm-c16-m15","semantic","2026-05-20T11:00:00Z","Hana has not begun querying other agents; Callista Ray is her first-choice agent and she intends to query exclusively for now.",["hana","querying"],0.6,"t15","user"),
  ],[
    q("clm-c16-q01","atomic_fact_recall","Who is Hana submitting her manuscript to?","Callista Ray at Inkwell Management.",["Callista Ray","Inkwell Management"],["clm-c16-m06"],[],"easy","low","Single stated fact."),
    q("clm-c16-q02","temporal_update","What is the current title of Hana's novel?","'The Weight of Salt' — changed from 'Saltwater Reckoning' in January 2026.",["The Weight of Salt"],["clm-c16-m02"],["clm-c16-m01"],"easy","medium","Must return the new title, not the original."),
    q("clm-c16-q03","contradiction_resolution","Is Hana's novel still called 'Saltwater Reckoning'?","No. She renamed it 'The Weight of Salt' in January 2026, feeling the original title was too literal.",["says no","The Weight of Salt"],["clm-c16-m02"],["clm-c16-m01"],"medium","medium","Tests resistance to the original working title."),
    q("clm-c16-q04","paraphrased_semantic_recall","What narrative perspective change did Hana make to the novel and why?","She switched from an omniscient third-person narrator to first-person perspective from Chapter 4 onward, after her writing group said the omniscient voice felt too distant.",["first-person","Chapter 4","writing group","distant"],["clm-c16-m05"],[],"medium","low","Rephrased from the POV-change record."),
    q("clm-c16-q05","atomic_fact_recall","How many words has Hana written so far, and what is her target?","72,000 words written; target is 85,000 words.",["72,000","85,000"],["clm-c16-m03"],[],"easy","low","Two numbers from one record."),
    q("clm-c16-q06","abstention","Has Hana begun querying other literary agents besides Callista Ray?","No. She intends to query Callista Ray exclusively for now and has not approached any other agents.",["no","Callista Ray exclusively","not querying others"],["clm-c16-m15"],[],"medium","low","Correctly abstains from implying broader querying."),
  ]),

  // ── C17 · Creative · Darius Cole / indie album ───────────────────────────
  conv("clm-c17-creative", "agent-creative-darius", "creative", [
    mem("clm-c17-m01","semantic","2025-11-01T09:00:00Z","Darius Cole is an indie musician based in Nashville recording his debut album 'Fractured Light', an 8-track alternative R&B record.",["darius","album"],0.8,"t01","user"),
    mem("clm-c17-m02","semantic","2026-01-15T10:00:00Z","The album was recorded at Soundwave Studios in Austin, TX, across three sessions between November 2025 and February 2026.",["darius","studio"],0.75,"t02","user"),
    mem("clm-c17-m03","semantic","2026-01-20T11:00:00Z","Darius co-wrote three of the eight tracks with producer Asha Benn, who also handled the mixing for those three tracks.",["darius","collaborators"],0.7,"t03","user"),
    mem("clm-c17-m04","semantic","2026-02-01T09:00:00Z","Darius signed with Midnight North Records, an independent label based in Brooklyn, for a two-album deal.",["darius","label"],0.75,"t04","user"),
    mem("clm-c17-m05","episodic","2026-02-10T10:00:00Z","The original release date for 'Fractured Light' was set for April 18, 2026.",["darius","release"],0.7,"t05","user"),
    mem("clm-c17-m06","episodic","2026-03-25T11:00:00Z","The release was pushed to August 8, 2026, to allow more time for vinyl production and a US tour to be organised around the launch.",["darius","release"],0.75,"t06","user",[assoc("clm-c17-m05",0.9,"supersedes original release date")]),
    mem("clm-c17-m07","episodic","2026-05-01T09:00:00Z","A pre-save campaign launched on Spotify and Apple Music on May 1, 2026, along with a music video teaser for the lead single 'Glass Hours'.",["darius","marketing"],0.65,"t07","user"),
    mem("clm-c17-m08","procedural","2026-05-10T10:00:00Z","Darius's mastering workflow: deliver 24-bit WAV stems to the mastering engineer at Precision Mastering in Nashville, review two reference masters, approve the final, then deliver DDP and streaming-format files to the label.",["darius","mastering-process"],0.65,"t08","user"),
    mem("clm-c17-m09","semantic","2026-05-15T11:00:00Z","Distractor: Darius grew up in Detroit and moved to Nashville in 2022 to pursue music full-time.",["darius","noise"],0.1,"t09","user"),
    mem("clm-c17-m10","semantic","2026-05-20T09:00:00Z","Distractor: The label owner at Midnight North Records previously managed a Grammy-nominated jazz quartet.",["darius","noise"],0.05,"t10","user"),
    mem("clm-c17-m11","semantic","2026-06-01T10:00:00Z","The lead single 'Glass Hours' is being serviced to DSPs with a July 11, 2026 release date — four weeks before the album.",["darius","singles"],0.65,"t11","user"),
    mem("clm-c17-m12","semantic","2026-06-05T11:00:00Z","Darius has not confirmed whether there will be any physical CD run; vinyl is confirmed, but CDs were not mentioned in the label contract.",["darius","physical"],0.55,"t12","user"),
    mem("clm-c17-m13","semantic","2026-06-08T09:00:00Z","Distractor: Asha Benn is based in Los Angeles and works primarily in soul and neo-soul production.",["darius","noise"],0.1,"t13","user"),
    mem("clm-c17-m14","semantic","2026-06-10T10:00:00Z","The US tour supporting 'Fractured Light' is planned for September–October 2026, with confirmed dates in Nashville, New York, and LA.",["darius","tour"],0.65,"t14","user"),
    mem("clm-c17-m15","semantic","2026-06-12T11:00:00Z","Distractor: Darius plays guitar, piano, and bass; he recorded most of the instrumental bed tracks himself.",["darius","noise"],0.1,"t15","user"),
  ],[
    q("clm-c17-q01","atomic_fact_recall","Where was 'Fractured Light' recorded?","Soundwave Studios in Austin, TX.",["Soundwave Studios","Austin"],["clm-c17-m02"],[],"easy","low","Single stated fact."),
    q("clm-c17-q02","temporal_update","When is 'Fractured Light' now scheduled for release?","August 8, 2026 — pushed back from the original April 18, 2026 release date.",["August 8","August 2026"],["clm-c17-m06"],["clm-c17-m05"],"easy","medium","Must return the revised release date."),
    q("clm-c17-q03","contradiction_resolution","Was 'Fractured Light' released on April 18, 2026?","No. The release was pushed to August 8, 2026, to allow for vinyl production and tour organisation.",["says no","August 8","pushed back"],["clm-c17-m06"],["clm-c17-m05"],"medium","medium","Tests resistance to the original (now lapsed) release date."),
    q("clm-c17-q04","paraphrased_semantic_recall","What was Darius's collaboration with Asha Benn on the album?","Asha Benn co-wrote three of the eight tracks with Darius and also mixed those three tracks.",["three tracks","co-wrote","mixing"],["clm-c17-m03"],[],"medium","low","Rephrased from the collaborator record."),
    q("clm-c17-q05","procedural_recall","Describe Darius's mastering workflow for the album.","Deliver 24-bit WAV stems to Precision Mastering in Nashville, review two reference masters, approve the final, then deliver DDP and streaming-format files to the label.",["24-bit WAV","Precision Mastering","DDP","review two reference masters"],["clm-c17-m08"],[],"medium","low","Direct procedural recall."),
    q("clm-c17-q06","abstention","Will there be a physical CD run for 'Fractured Light'?","Unknown. Vinyl is confirmed, but Darius has not confirmed whether a CD run will happen; it was not mentioned in the label contract.",["unknown","vinyl confirmed","CD not confirmed"],["clm-c17-m12"],[],"medium","low","Correctly abstains; distinguishes vinyl (confirmed) from CDs (unconfirmed)."),
  ]),

  // ── C18 · Creative · Yuki Tanaka / photography exhibition ────────────────
  conv("clm-c18-creative", "agent-creative-yuki", "creative", [
    mem("clm-c18-m01","semantic","2026-01-10T09:00:00Z","Yuki Tanaka is a fine-art photographer based in Chicago preparing a solo exhibition titled 'Liminal Spaces' focused on abandoned architecture and urban decay.",["yuki","exhibition"],0.8,"t01","user"),
    mem("clm-c18-m02","semantic","2026-01-15T10:00:00Z","The exhibition is being held at Gallery Zero in Chicago's West Loop neighbourhood.",["yuki","venue"],0.8,"t02","user"),
    mem("clm-c18-m03","episodic","2026-02-01T11:00:00Z","The original opening date for 'Liminal Spaces' was July 10, 2026.",["yuki","opening"],0.7,"t03","user"),
    mem("clm-c18-m04","episodic","2026-04-20T09:00:00Z","Due to a gallery renovation overrun, the opening was postponed to September 5, 2026.",["yuki","opening"],0.8,"t04","user",[assoc("clm-c18-m03",0.9,"replaces original opening date")]),
    mem("clm-c18-m05","semantic","2026-02-20T10:00:00Z","The exhibition will feature 24 photographs printed as archival pigment prints on 100% rag paper, in three size formats.",["yuki","works"],0.7,"t05","user"),
    mem("clm-c18-m06","semantic","2026-03-01T11:00:00Z","Yuki received an $8,000 project grant from the Illinois Arts Council to cover printing and framing costs.",["yuki","grant"],0.75,"t06","user"),
    mem("clm-c18-m07","semantic","2026-03-10T09:00:00Z","The photographs were taken across six locations: two decommissioned factories in Gary, Indiana; an abandoned school in East Chicago; a shuttered hotel in Detroit; and two vacant transit stations in Chicago.",["yuki","locations"],0.7,"t07","user"),
    mem("clm-c18-m08","semantic","2026-04-01T10:00:00Z","Distractor: Yuki also teaches a weekend photography workshop at the Chicago Cultural Center twice a year.",["yuki","noise"],0.1,"t08","user"),
    mem("clm-c18-m09","semantic","2026-04-10T11:00:00Z","Yuki has a limited-edition catalogue of 'Liminal Spaces' being printed by a local press in an edition of 200 copies.",["yuki","catalogue"],0.6,"t09","user"),
    mem("clm-c18-m10","semantic","2026-04-15T09:00:00Z","Distractor: Yuki trained under photographer Hiroshi Sugimoto's studio assistant during a residency in New York in 2019.",["yuki","noise"],0.05,"t10","user"),
    mem("clm-c18-m11","semantic","2026-05-01T10:00:00Z","Yuki has not decided whether to sell prints at the exhibition or reserve them for gallery placement only.",["yuki","sales"],0.55,"t11","user"),
    mem("clm-c18-m12","semantic","2026-05-10T11:00:00Z","The gallery opening reception on September 5 will run 6–9 PM; the exhibition will remain on view through October 12, 2026.",["yuki","dates"],0.65,"t12","user"),
    mem("clm-c18-m13","semantic","2026-05-15T09:00:00Z","Distractor: Gallery Zero represents 14 artists and focuses primarily on photography and video art.",["yuki","noise"],0.1,"t13","user"),
    mem("clm-c18-m14","semantic","2026-06-01T10:00:00Z","All 24 images have been finalised and sent to the print lab; no additional images will be added to the exhibition.",["yuki","works"],0.65,"t14","user"),
    mem("clm-c18-m15","semantic","2026-06-10T11:00:00Z","Distractor: Yuki is also working on a personal long-term project photographing Great Lakes shipping ports, unrelated to 'Liminal Spaces'.",["yuki","noise"],0.1,"t15","user"),
  ],[
    q("clm-c18-q01","atomic_fact_recall","At which gallery is 'Liminal Spaces' being exhibited?","Gallery Zero in Chicago's West Loop.",["Gallery Zero","West Loop"],["clm-c18-m02"],[],"easy","low","Single stated fact."),
    q("clm-c18-q02","temporal_update","When is the opening of 'Liminal Spaces'?","September 5, 2026 — postponed from the original date of July 10, 2026.",["September 5","September 2026"],["clm-c18-m04"],["clm-c18-m03"],"easy","medium","Must return the rescheduled date."),
    q("clm-c18-q03","contradiction_resolution","Did 'Liminal Spaces' open on July 10, 2026?","No. The opening was postponed to September 5, 2026, due to a gallery renovation overrun.",["says no","September 5","postponed"],["clm-c18-m04"],["clm-c18-m03"],"medium","medium","Tests resistance to the original date."),
    q("clm-c18-q04","paraphrased_semantic_recall","What are the main subjects and themes of Yuki's photographs?","Abandoned architecture and urban decay — specifically decommissioned factories, an abandoned school, a shuttered hotel, and vacant transit stations.",["abandoned architecture","urban decay"],["clm-c18-m01","clm-c18-m07"],[],"medium","low","Rephrased from the thematic and location records."),
    q("clm-c18-q05","atomic_fact_recall","How much did Yuki receive from the Illinois Arts Council grant?","$8,000 for printing and framing costs.",["$8,000","8,000"],["clm-c18-m06"],[],"easy","low","Single stated fact."),
    q("clm-c18-q06","abstention","Will prints be for sale at the 'Liminal Spaces' exhibition?","Undecided. Yuki has not yet decided whether to sell prints directly or reserve them for gallery placement.",["undecided","not decided","no decision"],["clm-c18-m11"],[],"medium","low","Correctly abstains from inventing a sales decision."),
  ]),

  // ── C19 · Creative · Sam Okafor / indie game development ─────────────────
  conv("clm-c19-creative", "agent-creative-sam", "creative", [
    mem("clm-c19-m01","semantic","2025-07-01T09:00:00Z","Sam Okafor is a solo indie game developer based in Lagos building 'Hollow Meridian', a 2D puzzle platformer, using Godot 4.",["sam","game"],0.8,"t01","user"),
    mem("clm-c19-m02","semantic","2025-11-01T10:00:00Z","Sam launched a Steam page for 'Hollow Meridian' in November 2025 and accumulated 4,200 wishlists within two months.",["sam","steam"],0.7,"t02","user"),
    mem("clm-c19-m03","semantic","2025-09-01T11:00:00Z","The game targets PC (Steam) and Nintendo Switch as its release platforms.",["sam","platforms"],0.75,"t03","user"),
    mem("clm-c19-m04","episodic","2026-01-15T09:00:00Z","Devolver Digital approached Sam with a publishing offer in January 2026, which he declined, preferring to self-publish.",["sam","publisher"],0.75,"t04","user"),
    mem("clm-c19-m05","semantic","2026-02-01T10:00:00Z","Sam is targeting a Q3 2026 release (July–September 2026) for 'Hollow Meridian'.",["sam","release"],0.75,"t05","user"),
    mem("clm-c19-m06","procedural","2026-02-10T11:00:00Z","Sam's level design workflow: sketch puzzle flow on paper → prototype in Godot with placeholder art → playtest with 3 remote testers → revise → lock the level with final art.",["sam","workflow"],0.7,"t06","user"),
    mem("clm-c19-m07","semantic","2026-03-01T09:00:00Z","The game has 30 levels across 5 chapters; chapters 1–3 are content-complete, chapters 4–5 are in design phase.",["sam","progress"],0.7,"t07","user"),
    mem("clm-c19-m08","semantic","2026-03-10T10:00:00Z","Distractor: Sam livestreams his development on YouTube under the handle 'SamBuildsGames' and has 12,000 subscribers.",["sam","noise"],0.1,"t08","user"),
    mem("clm-c19-m09","semantic","2026-04-01T11:00:00Z","The soundtrack is being composed by a musician named Lena Osei (no relation to Sam) based in Berlin.",["sam","soundtrack"],0.6,"t09","user"),
    mem("clm-c19-m10","semantic","2026-04-10T09:00:00Z","Distractor: Sam previously shipped a small mobile game called 'Block Dash' in 2022, which received 500 downloads before being delisted.",["sam","noise"],0.1,"t10","user"),
    mem("clm-c19-m11","semantic","2026-05-01T10:00:00Z","Sam has not confirmed whether a physical cartridge edition for Nintendo Switch will be produced.",["sam","physical"],0.5,"t11","user"),
    mem("clm-c19-m12","semantic","2026-05-10T11:00:00Z","The game's demo was released on Steam Next Fest in February 2026 and received over 900 downloads.",["sam","demo"],0.65,"t12","user"),
    mem("clm-c19-m13","semantic","2026-05-15T09:00:00Z","Distractor: The art style is described as 'brutalist pixel art' — high contrast, monochromatic with selective use of a single accent colour.",["sam","art"],0.2,"t13","user"),
    mem("clm-c19-m14","semantic","2026-06-01T10:00:00Z","Sam's wishlist count stood at approximately 4,200 as of the Steam page launch; he has not publicly updated the count since.",["sam","steam"],0.6,"t14","user",[assoc("clm-c19-m02",0.9,"clarifies the wishlist count is from launch")]),
    mem("clm-c19-m15","semantic","2026-06-10T11:00:00Z","Distractor: Godot 4 uses GDScript and C# as its primary scripting languages; Sam uses GDScript exclusively.",["sam","tech"],0.2,"t15","user"),
  ],[
    q("clm-c19-q01","atomic_fact_recall","What game engine is 'Hollow Meridian' built in?","Godot 4.",["Godot 4","Godot"],["clm-c19-m01"],[],"easy","low","Single stated fact."),
    q("clm-c19-q02","atomic_fact_recall","What platforms is 'Hollow Meridian' targeting?","PC (Steam) and Nintendo Switch.",["PC","Steam","Nintendo Switch"],["clm-c19-m03"],[],"easy","low","Two platforms from one record."),
    q("clm-c19-q03","paraphrased_semantic_recall","Describe Sam's process for designing and locking a level.","Sketch the puzzle flow on paper, prototype in Godot with placeholder art, playtest with three remote testers, revise based on feedback, then lock the level with final art.",["sketch","prototype","playtest","3 testers","final art"],["clm-c19-m06"],[],"medium","low","Rephrased from the workflow record."),
    q("clm-c19-q04","noise_resistance","Did Sam sign a publishing deal with Devolver Digital?","No. Devolver approached Sam in January 2026 but he declined and chose to self-publish.",["says no","declined","self-publish"],["clm-c19-m04"],[],"medium","low","Tests that the system records a declined offer, not a signed deal."),
    q("clm-c19-q05","temporal_update","How many wishlists does 'Hollow Meridian' have on Steam?","Approximately 4,200, accumulated within two months of the Steam page launching in November 2025. Sam has not publicly updated the count since.",["4,200","4200"],["clm-c19-m02","clm-c19-m14"],[],"medium","medium","Wishlist count is from launch; system must not fabricate a higher current number."),
    q("clm-c19-q06","abstention","Will there be a physical Nintendo Switch cartridge for 'Hollow Meridian'?","Unknown. Sam has not confirmed whether a physical edition will be produced.",["not confirmed","unknown","no announcement"],["clm-c19-m11"],[],"medium","low","Correctly abstains."),
  ]),

  // ── C20 · Creative · Nadia Osei / 'Undercurrent' podcast ─────────────────
  conv("clm-c20-creative", "agent-creative-nadia", "creative", [
    mem("clm-c20-m01","semantic","2024-06-01T09:00:00Z","Nadia Osei hosts and produces 'Undercurrent', an investigative journalism podcast covering fintech fraud and financial misconduct.",["nadia","podcast"],0.8,"t01","user"),
    mem("clm-c20-m02","episodic","2026-01-01T10:00:00Z","At the start of 2026, 'Undercurrent' had 28 published episodes and averaged 55,000 listeners per episode.",["nadia","stats"],0.7,"t02","user"),
    mem("clm-c20-m03","semantic","2026-01-01T11:00:00Z","Until March 2026, 'Undercurrent' was exclusive to Spotify under a 3-month licensing deal.",["nadia","distribution"],0.75,"t03","user"),
    mem("clm-c20-m04","episodic","2026-04-01T09:00:00Z","From April 2026 onward, 'Undercurrent' became available on all major podcast platforms: Apple Podcasts, Spotify, Pocket Casts, and RSS.",["nadia","distribution"],0.8,"t04","user",[assoc("clm-c20-m03",0.9,"Spotify exclusivity ended")]),
    mem("clm-c20-m05","semantic","2026-01-15T10:00:00Z","Episodes were published every Thursday until April 2026.",["nadia","schedule"],0.7,"t05","user"),
    mem("clm-c20-m06","episodic","2026-04-01T11:00:00Z","Starting April 2026, Nadia moved the release schedule to Tuesdays — partly to reduce competition with a surge of Thursday true-crime shows.",["nadia","schedule"],0.75,"t06","user",[assoc("clm-c20-m05",0.9,"replaces Thursday schedule")]),
    mem("clm-c20-m07","episodic","2026-06-01T09:00:00Z","As of June 2026, 'Undercurrent' has 42 published episodes and averages 85,000 listeners per episode.",["nadia","stats"],0.8,"t07","user",[assoc("clm-c20-m02",0.85,"updated stats")]),
    mem("clm-c20-m08","semantic","2026-03-01T10:00:00Z","Nadia's first sponsor was Wren, a carbon-offsetting company, for a 2-episode deal beginning in March 2026.",["nadia","sponsor"],0.7,"t08","user"),
    mem("clm-c20-m09","episodic","2026-05-15T11:00:00Z","Wren extended their sponsorship from 2 episodes to 6 episodes after seeing strong listener engagement and a 12% click-through rate on the mid-roll ad.",["nadia","sponsor"],0.75,"t09","user",[assoc("clm-c20-m08",0.9,"sponsorship expanded")]),
    mem("clm-c20-m10","semantic","2026-05-20T09:00:00Z","Distractor: Nadia was a financial journalist at Reuters for 5 years before launching 'Undercurrent'.",["nadia","noise"],0.1,"t10","user"),
    mem("clm-c20-m11","semantic","2026-06-01T10:00:00Z","Nadia produces the show alone: she conducts interviews, writes the scripts, records narration, and edits audio using Adobe Audition.",["nadia","production"],0.65,"t11","user"),
    mem("clm-c20-m12","semantic","2026-06-05T11:00:00Z","Distractor: 'Undercurrent' has a Patreon with 480 supporters at the $7/month tier.",["nadia","noise"],0.15,"t12","user"),
    mem("clm-c20-m13","semantic","2026-06-08T09:00:00Z","Nadia has not yet announced a second season structure or a change in show format; the podcast continues as episodic investigations.",["nadia","roadmap"],0.55,"t13","user"),
    mem("clm-c20-m14","semantic","2026-06-10T10:00:00Z","The show was nominated for a Webby Award in the journalism category for 2026, though the results have not yet been announced.",["nadia","awards"],0.6,"t14","user"),
    mem("clm-c20-m15","semantic","2026-06-12T11:00:00Z","Distractor: Nadia is based in London and records in a home studio with acoustic treatment.",["nadia","noise"],0.1,"t15","user"),
  ],[
    q("clm-c20-q01","atomic_fact_recall","What is the subject matter of the 'Undercurrent' podcast?","Investigative journalism covering fintech fraud and financial misconduct.",["fintech fraud","financial misconduct","investigative journalism"],["clm-c20-m01"],[],"easy","low","Single stated fact."),
    q("clm-c20-q02","temporal_update","How many episodes has 'Undercurrent' published as of June 2026?","42 episodes, up from 28 at the start of 2026.",["42","forty-two"],["clm-c20-m07"],["clm-c20-m02"],"easy","medium","Must return the June 2026 count, not the January 2026 one."),
    q("clm-c20-q03","contradiction_resolution","Does 'Undercurrent' still publish on Thursdays?","No. Nadia moved to a Tuesday release schedule in April 2026 to avoid competition with a surge of Thursday true-crime shows.",["says no","Tuesday","April 2026"],["clm-c20-m06"],["clm-c20-m05"],"medium","medium","Tests resistance to the Thursday schedule."),
    q("clm-c20-q04","paraphrased_semantic_recall","How did the listener numbers for 'Undercurrent' change from January to June 2026?","From 55,000 average listeners per episode in January 2026 to 85,000 in June 2026 — an increase of 30,000.",["55,000","85,000","30,000"],["clm-c20-m02","clm-c20-m07"],[],"medium","low","Requires two records for the comparison."),
    q("clm-c20-q05","multi_hop","What caused the Wren sponsorship to expand from 2 episodes to 6?","The extension was driven by strong listener engagement and a 12% click-through rate on the mid-roll ad placement.",["12% click-through","listener engagement","mid-roll"],["clm-c20-m09"],[],"medium","low","Requires linking the sponsorship expansion record to its stated cause."),
    q("clm-c20-q06","temporal_update","Is 'Undercurrent' still a Spotify exclusive?","No. The 3-month exclusivity deal ended in March 2026; from April 2026 the show is available on all major platforms.",["not exclusive","all platforms","April 2026"],["clm-c20-m04"],["clm-c20-m03"],"medium","medium","Tests that the system reflects the end of the exclusivity period."),
  ]),
];

// ─── dataset assembly ──────────────────────────────────────────────────────────
const dataset = {
  name: "memory-bench-realistic-medium",
  description: "Dataset B (Realistic Medium): 20 conversations across 8 domains with 300 memory records and 120 questions. Unique personas, realistic narrative arcs, temporal updates, and adversarial noise — provider-neutral across vector and graph-based memory systems.",
  generated_at: "2026-06-19",
  generated_by: "claude",
  version: "1.0.0",
  fairness_notes: [
    "No graph-traversal, memory-passport, decay, or metadata assumptions. Every question is answerable from the raw text content of the memory records alone.",
    "Multi-hop questions are capped at 10% of total (12 of 120) — they do not require graph traversal; they require retrieving two related records and synthesising a plain-text answer.",
    "Temporal-update and contradiction-resolution questions (each ~15%) test recency handling without assuming the underlying store uses timestamps as first-class index keys — a system can answer correctly via semantic content alone (e.g., 'after negotiation' or 'as of May 2026').",
    "Near-duplicate-name noise (Kai/Kira, Yuki Nakamura/Yuki Tanaka, Lena Osei/Nadia Osei) is equally challenging for vector similarity search and graph-entity matching; disambiguation requires content, not topology.",
    "Abstention questions cover both true knowledge gaps (information never stored) and explicitly-stated uncertainty (e.g., 'Nadia has not yet decided') to prevent trivial keyword-absence detection.",
    "All 20 conversations use distinct personas, domains, and narrative arcs — no recycled content patterns across conversations.",
  ],
  stats: {
    conversations: 20,
    memory_records: 300,
    questions: 120,
    domains: ["software","personal_assistant","research","healthcare","education","finance","legal","creative"],
    question_categories: {
      atomic_fact_recall: 28,
      paraphrased_semantic_recall: 20,
      temporal_update: 22,
      contradiction_resolution: 20,
      noise_resistance: 10,
      multi_hop: 10,
      procedural_recall: 4,
      abstention: 6,
    },
  },
  conversations,
};

// ─── verify stats ──────────────────────────────────────────────────────────────
let totalMem = 0, totalQ = 0;
const catCounts = {};
for (const c of conversations) {
  totalMem += c.memory_records.length;
  totalQ += c.questions.length;
  for (const q of c.questions) {
    catCounts[q.category] = (catCounts[q.category] || 0) + 1;
  }
}
console.log(`Conversations: ${conversations.length}`);
console.log(`Memory records: ${totalMem}`);
console.log(`Questions: ${totalQ}`);
console.log("Category breakdown:", catCounts);

// ─── write file ────────────────────────────────────────────────────────────────
const outPath = join(__dirname, "dataset_claude_realistic_medium.json");
writeFileSync(outPath, JSON.stringify(dataset, null, 2), "utf8");
console.log(`\n✓ Written to ${outPath}`);

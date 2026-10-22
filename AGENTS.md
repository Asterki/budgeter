You are an expert full-stack developer. Build an end-to-end, fully functional, production-ready todo web application named "Tasker". Follow the instructions below precisely, avoiding any placeholders, mock implementations, or shortcuts.

### Design System Reference (DESIGN.md Alignment)
- Incorporate a clean Nordic aesthetic: crisp typography, generous functional whitespace, and high-contrast readable states.
- Color Palette: Ice blue/slate accents, cool gray backgrounds, distinct muted tones for low priority, and sharp accents for high priority.
- Desktop UI: Implement a cohesive global menu layout optimized for large viewports, adhering to a clean, left-aligned window control scheme.
- Mobile UI: Implement a swipe-to-close bottom sheet drawer for creation and details panel interfaces, optimized entirely for thumb zone interactions.

### Architecture & Runtime Environment
- Framework & Deployment: Built as a TypeScript Single Page Application (SPA). The app is explicitly configured for deployment to Vercel. 
- Multi-Environment Support: Provide a robust production configuration natively within the build pipeline config (e.g., angular.json, vite.config.ts, or next.config.js as applicable) to handle environment replacements seamlessly.
- Data Ownership & Performance: Single-user architecture with no account registration or authentication middleware. The application is completely local-first. All task, project, and subscription configurations must be stored locally on the client device using IndexedDB for high-throughput, structured data persistence.
- Offline Capability & PWA: Fully installable Progressive Web App (PWA). Configure a custom service worker (`sw.js`) that handles network caching for true offline-first operations.
- Data Portability: Provide direct, easy-to-use JSON export and import options in the UI to backup or restore the entire application state.

### Core Features & Views
1. Project & Categorization Engine: Users can create and manage isolated Projects. Each project supports its own set of custom tags.
2. Cross-Sectional Views:
   - "Tasks" View: A clean list layout emphasizing quick sorting, debounced live-filtering, and task manipulation.
   - Calendar View: An interactive calendar displaying task distribution across days and weeks.
   - Roadmap View: A timeline displaying tasks grouped by execution sequences and deadlines.
3. Metadata Engine: Support Priorities (1 to 4), physical/contextual Places, absolute Dates, absolute Times, and granular time settings (All-day events vs. micro-scheduled timeframes).
4. Recurrence Engine: Robust handling for recurring criteria, supporting both straightforward cycles (e.g., daily, weekly) and highly customized recurring patterns.
5. Inline Natural Language Parsing (Todoist-Style): 
   - Implement an intelligent, instantaneous input parser. As the user types, it visually reflects parsed metrics.
   - Example Input: "Create a new feature in the app @work tomorrow !1 #UNAH"
   - Expected Output: A task with title "Create a new feature in the app", dated for the exact next calendar day, assigned Context/Place: "work", Priority: "1", and mapped to Project: "UNAH".

### Notification Engine (Vercel Cron + Web Push)
- Serverless Wakeups: Create a root-level `vercel.json` configuring a Vercel Cron Job to call `/api/check-reminders` exactly every minute (`* * * * *`).
- The Client Setup: The frontend must request browser notification permissions. If granted, the service worker must subscribe via the browser's `PushManager` using VAPID keys, passing the subscription payload to be saved inside the local IndexedDB.
- The Serverless Handler: Build the serverless endpoint (`/api/check-reminders.ts`) using the standard Node.js/TypeScript `web-push` library. 
- Process Flow: When called by Vercel Cron, the function fetches the active push subscription and upcoming tasks, checks for exact timestamp matches against the current system time, sends a secure, encrypted Web Push payload to the browser vendor endpoint, and marks the task as reminded.
- Background Delivery: The application's service worker must contain an active listener for the 'push' event. When fired, it must read the payload and safely call `self.registration.showNotification()` to alert the user even if the browser tab and app are completely closed.

### Implementation Constraints
- STRICTLY FORBIDDEN: Do not create a separate shared function utility library. All code must reside systematically within its structural domain.
- STRICTLY FORBIDDEN: Do not write extensive unit, integration, or E2E tests. Focus purely on clean, production-grade application code.
- KEEP IT SIMPLE: Avoid overengineering. Optimize code for maintenance, readable code paths, and performant UI updates.

### Required Deliverables
1. Complete, functional code files containing the complete implementation for the frontend app, service worker, serverless API endpoint, and deployment config files.
2. An inline Markdown User Manual explaining the application layout, shortcuts, natural language syntax tokens (`@`, `!`, `#`), backup instructions, and how notifications are initialized.

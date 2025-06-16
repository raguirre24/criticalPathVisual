# Critical Path Visual

This repository contains a Power BI custom visual that analyzes project schedules using a schedule-based Critical Path Method (CPM). The visual treats start and finish dates as fixed constraints and derives task durations automatically when not provided. It computes total float, detects constraint violations, and highlights critical relationships.

## Prerequisites
- Node.js 18+
- `pbiviz` command line tool (`npm install -g powerbi-visuals-tools`)

## Installation
```bash
npm install
```

## Development
Run the visual in watch mode:
```bash
npm run start
```

Build the production package:
```bash
npm run package
```

Run linting and TypeScript compile checks:
```bash
npm run lint
npx tsc -p .
```

Execute tests:
```bash
npm test
```

## Data Roles
The visual requires the following fields:
- **taskId** – unique identifier for each task
- **startDate** – task start date
- **finishDate** – task finish date
- **(optional)** **duration** – if omitted, it will be derived from the start and finish dates

Relationships between tasks can include predecessor IDs, relationship types (FS/SS/FF/SF), lags and free float.

## Schedule-Based Analysis
Unlike traditional CPM calculations that determine when tasks should occur, this visual analyzes a provided schedule. Start and finish dates are not adjusted; instead, the algorithm calculates earliest and latest required times to determine float and highlight violations. Trace forward/backward functions and the web worker use this same analysis.

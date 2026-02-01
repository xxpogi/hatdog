# Observability Platform

A production-grade, free website uptime and observability platform that rivals UptimeRobot, Datadog, and Grafana. Built with modern architecture principles for global scale, AI-powered insights, and team collaboration.

## Features

### Core Monitoring
- **Global Edge-Based Checks**: Monitor from North America, Europe, and Asia-Pacific
- **Multi-Protocol Support**: HTTP, HTTPS, TCP, ICMP
- **Custom Headers & Body**: Full request customization
- **SSL Verification**: Optional certificate validation
- **Response Validation**: Status code and body matching

### Advanced Detection
- **DDoS Detection**: Heuristic-based attack detection
- **Packet Loss Detection**: Network degradation identification
- **Anomaly Detection**: Statistical pattern analysis
- **Quorum-Based Downtime**: Multi-region consensus for accuracy

### AI-Powered RCA
- **Root Cause Analysis**: Automated incident explanation
- **Evidence Collection**: Metrics-backed reasoning
- **Confidence Scoring**: Reliability indicators
- **Recommendations**: Actionable remediation steps

### Alerting
- **Multiple Channels**: Webhooks, Discord, Slack, Email
- **Rich Embeds**: Charts and summaries
- **Signed Payloads**: HMAC verification for security
- **Retry Logic**: Reliable delivery

### SLO/SLA Tracking
- **Uptime SLOs**: Percentage-based targets
- **Latency SLOs**: P95/P99 thresholds
- **Error Budgets**: Burn rate tracking
- **Breach Prediction**: Proactive notifications

### Dashboards
- **Grafana-Style Builder**: Drag-and-drop panels
- **Multiple Panel Types**: Time-series, gauges, heatmaps
- **Real-Time Updates**: Live data refresh
- **Shared Dashboards**: Team collaboration

### Team Management
- **RBAC**: Owner, Admin, Member, Viewer roles
- **Project Isolation**: Separate monitoring contexts
- **Audit Logging**: Activity tracking
- **Invite System**: Easy member onboarding

### Public Status Pages
- **Custom URLs**: Branded status pages
- **Regional Status**: Per-location health
- **Incident History**: Transparent communication
- **SEO-Friendly**: Cached and indexed

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL (Neon)
- **ORM**: Prisma
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **Charts**: Recharts
- **Auth**: Custom session-based
- **Deployment**: Vercel (Edge + Cron)

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon recommended)
- Vercel account (for deployment)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/observability-platform.git
cd observability-platform
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your configuration:
```env
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"
AUTH_SECRET="your-secret-key-min-32-characters-long"
AUTH_COOKIE_NAME="observability_session"
OPENAI_API_KEY="" # Optional, for enhanced RCA
CRON_SECRET="your-cron-secret"
VERCEL_URL="your-app.vercel.app"
```

4. Set up the database:
```bash
npx prisma migrate dev
npx prisma generate
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Vercel

1. Push your code to GitHub/GitLab/Bitbucket
2. Import the project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

The included `vercel.json` configures:
- Cron jobs for monitoring (every minute)
- SLO calculation (every 6 hours)
- Data cleanup (daily)

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `AUTH_SECRET` | Secret for session encryption | Yes |
| `AUTH_COOKIE_NAME` | Name of the session cookie | No |
| `CRON_SECRET` | Secret for cron job authentication | Yes |
| `OPENAI_API_KEY` | For AI-enhanced RCA | No |
| `VERCEL_URL` | Your Vercel deployment URL | Yes |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  Next.js App Router (Server Components + Client Components)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          EDGE LAYER                              │
│  Vercel Edge Functions                                          │
│  ├── /api/edge/monitor      - Global health checks              │
│  ├── /api/edge/ddos-detect  - Anomaly detection                 │
│  └── /api/edge/rca          - AI root cause analysis            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER LAYER                             │
│  Server Actions + Route Handlers                                 │
│  ├── Auth, Teams, Monitors, Dashboards, Alerts, SLOs            │
│  └── Cron jobs for scheduled tasks                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                              │
│  PostgreSQL (Neon) with Prisma ORM                              │
│  ├── Time-series optimized tables                               │
│  └── Comprehensive indexing for performance                     │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

The platform includes 20+ tables:

- **users**, **sessions** - Authentication
- **teams**, **team_members** - RBAC
- **projects** - Monitoring containers
- **monitors**, **monitor_regions** - Check configuration
- **monitor_checks** - Time-series data
- **incidents** - Issue tracking
- **network_events** - DDoS/packet loss
- **rca_reports** - AI analysis
- **alert_configs**, **alerts** - Notification system
- **slo_definitions**, **slo_windows** - Compliance tracking
- **dashboards**, **dashboard_panels** - Visualization
- **audit_logs** - Activity tracking

## API Reference

### Edge Endpoints

#### POST /api/edge/monitor
Execute a health check from an edge location.

**Body:**
```json
{
  "monitorId": "string",
  "regionId": "string"
}
```

#### POST /api/edge/ddos-detect
Analyze traffic patterns for anomalies.

**Body:**
```json
{
  "monitorId": "string"
}
```

#### POST /api/edge/rca
Generate root cause analysis for an incident.

**Body:**
```json
{
  "incidentId": "string"
}
```

### Public Status Pages

#### GET /api/status/:slug
Get public status page data.

**Response:**
```json
{
  "project": { "name": "string", "team": "string" },
  "status": "operational|degraded|major-outage",
  "monitors": [...],
  "incidents": [...],
  "lastUpdated": "ISO timestamp"
}
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

- Documentation: [docs.observability-platform.dev](https://docs.observability-platform.dev)
- Issues: [GitHub Issues](https://github.com/yourusername/observability-platform/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/observability-platform/discussions)

---

Built with ❤️ for the observability community.
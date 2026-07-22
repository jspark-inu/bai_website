# BAI redesign inventory

This document records the production-source redesign applied on the `park/bai-suit-redesign` branch and the functional surface checked before handoff.

## Design system

- Type: `SUIT Variable`, with Apple and Noto Sans Korean system fallbacks
- Background: `#EAEAEA`
- Primary: `#14332B`
- Accent: `#7BBA91`
- Navigation: fixed grouped sidebar on desktop, drawer on narrow screens
- Content: restrained editorial cards, compact lists, visible focus states, and reduced-motion support

The approved static sources remain mirrored byte-for-byte:

- `frontend/krds.css` to `apps/web/public/static/krds.css`
- `frontend/krds.js` to `apps/web/public/static/krds.js`

## Route and feature coverage

| Surface | Route | Preserved behavior |
| --- | --- | --- |
| Home | `/` | Weekly prompt, my-week action, weekly member check-in, recent free records, encouragement |
| Free records | `/feed` | Create and filter general records; excludes project activity and blocked questions |
| Record detail | `/post/:id` | Markdown, edit, comments, reactions |
| Projects | `/projects`, `/projects/:id` | Create, list, uniform cards, detail, linked activity |
| Blocked questions | `/questions` | Compact unanswered-question cards and answer entry |
| Talent office | `/talent-office`, `/talent-office/:id` | Request, review, assignment, solution, decision workflow |
| Materials | `/materials` | Create, edit, delete, categories, links, date with author below it |
| Members | `/members`, `/member/:id` | First-view compact directory and member activity detail |
| Search and tags | `/search`, `/tag/:tag` | Query, result navigation, tag-filtered records |
| Help | `/ask` | FAQ, inquiry submission, PI answers |
| Goodbai | `/developer`, `/goodbai` | API key view, copy, and regeneration; direct reload supported |
| Account | `/account` | Password change |
| Member admin | `/admin/members` | PI member administration |
| Public introduction | `/about` | Public BAI introduction using the same visual system |

## Authentication contract

The redesigned login continues to submit to `/api/login`. This is intentional: the Flask-backed proxy endpoints require the legacy session cookie. Error, rate-limit, loading, keyboard submit, and logout behavior remain available.

## Verification commands

Run from `apps/web`:

```sh
npm run typecheck
npm test
npm run design:park
npm run build
```

The browser QA pass also checks desktop overflow, SUIT loading, route entry, equal project-card heights, compact question width, material author placement, first-view member density, and content separation between free records, project activity, and blocked questions.

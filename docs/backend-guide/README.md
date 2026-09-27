# The backend guide source

`../UstaadAssist-Backend-Guide.pdf` is generated from the `part*.md` files here.

To change the guide, edit the relevant `part*.md` and re-render:

    python docs/backend-guide/render.py docs/backend-guide docs/UstaadAssist-Backend-Guide.pdf

It needs Python with `reportlab` installed (`pip install reportlab`). This is a
documentation tool only — it is not part of the server and nothing in `src/`
depends on it.

The files are rendered in filename order:

| File | Chapters |
|---|---|
| `part1.md` | 1 - what the backend is, the request flow, the file map |
| `part2.md` | 2 - the TypeScript and JavaScript syntax used |
| `part3.md` | 3 - the database and the SQL techniques |
| `part4.md` | 4 - authentication and ownership |
| `part5.md` | 5 - the plumbing files |
| `part6.md` | 6 - the planner |
| `part7.md` | 7 - the grading engine |
| `part8.md` | 8 - the services |
| `part9.md` | 9 - every endpoint |
| `part9b.md` | 10 - Swagger and the API contract |
| `partA.md` | 11, 12 - stubs, seeding and smoke testing |
| `partB.md` | 13 - deploying to Vercel |
| `partD.md` | 14 - quick reference |

Files render in filename order, which is why the later ones are lettered: a new
chapter slots in by choosing a name that sorts into the right place.

`render.py` documents the small markup language at the top of the file
(headings, bullets, tables, code blocks, `!NOTE` and `!WARN` callouts).

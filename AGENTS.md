<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Quota engine logic lives in pure `src/lib/quota/engine.ts` (tested); server functions in `quota.functions.ts` read an in-memory seeded store (`store.server.ts`) — why: platform can't run FastAPI/SQLite, and pure logic keeps rules testable.

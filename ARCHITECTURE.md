# Night Memo modular architecture

## Dependency direction

```text
pages ───────> services ───────> data
  │               │               │
  ├──────────────> domain <────────┘
  └──────────────> components ───> core
                      │
domain ─────────────> core
```

`core/` and `domain/` do not initialise Supabase. Pure report rules, date rules, normalization, validation and sequencing can therefore be tested without a database session.

## Folder ownership

- `core/` — generic DOM/UI helpers, Hong Kong calendar-date policy, numeric helpers, request sequencing and template-message/CSS security.
- `domain/` — Night Memo payload defaults, legacy normalization, validation, calculations and historical compatibility.
- `data/client.js` — DB mode and the one Supabase client. The browser ESM dependency is version-pinned.
- `data/repositories/` — persistence grouped by capability: access, wards/capacity, reports, report items, staff, accounts, audit and print templates.
- `data/demo-state.js` — demo persistence and seed state shared by repositories.
- `data/legacy-aggregates.js` — temporary compatibility aggregate for old callers only.
- `services/` — multi-repository application operations such as loading/saving one report context and authentication workflows.
- `components/` — reusable shell/controls and the read-only full ward report.
- `pages/` — page state, workflow and browser event binding.
- root compatibility files — `database.js`, `auth.js`, `manager-template-store.js`, `app.js`, page entry points and `report-renderer.js` preserve existing import/script paths.
- `tests/` — Node regression checks for pure domain/core behaviour.

## Report model invariants

1. **Date:** the default report date is the Hong Kong calendar date (`Asia/Hong_Kong`), not `Date.toISOString()` UTC date.
2. **Selected vs loaded:** a page must not save data until the selected date is also the date whose request successfully completed.
3. **Async ordering:** an earlier response is ignored after a later date request begins.
4. **Missing vs zero:** report rendering derives legacy missing values where possible instead of converting absence into a false zero.
5. **Historical compatibility:** re-saving preserves unknown dynamic/device fields.
6. **Historical definitions:** use `report_item_snapshot` when available; otherwise resolve effective-dated items including those later made inactive.
7. **Device compatibility:** both legacy arrays and `{mode,count,beds}` normalize to one representation.
8. **Printing:** Ward print stays a lazy-loaded boundary; Manager template print is isolated in its iframe/window path.
9. **Template security:** message source+origin are verified, custom CSS is conservative-sanitized, and CSS enters the document only through `style.textContent`.

## Compatibility strategy

The root file names used by the current HTML remain valid. For example, `ward.html` still loads `ward.js`, but that root file now only loads `pages/ward-page.js`. The same approach is used for Manager, Maintenance and Login.

`database.js`, `auth.js`, and `manager-template-store.js` are facades rather than implementations. Existing modules such as `ward-print.js` can continue to import old paths while new code imports the explicit data/service modules.

This makes the refactor incremental rather than a single deployment that simultaneously changes HTML, UI, data access and backend contracts.

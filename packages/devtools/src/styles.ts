export const styles = `
:host { display:block; color:#182538; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color-scheme:light; }
* { box-sizing:border-box; } button,input,textarea,select { font:inherit; } button { cursor:pointer; }
button:disabled { cursor:default; opacity:.5; } :focus-visible { outline:3px solid #94b7ff; outline-offset:3px; }
.app { background:#f3f5f9; min-height:90vh; padding:28px; border-radius:16px; }
.header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
.brand { display:flex; align-items:center; gap:12px; }.logo { background:#225ce4; color:white; font-size:22px; font-weight:750; border-radius:12px; width:44px; height:44px; display:grid; place-items:center; }
h1,h2,p { margin:0; } h1 { font-size:21px; letter-spacing:-.5px; } h2 { font-size:15px; font-weight:650; }
.sub,.muted { color:#6a778b; font-size:12px; }.sub { margin-top:2px; }.env { color:#247653; background:#e6f4ec; border:1px solid #c6e5d4; padding:5px 10px; border-radius:20px; font-size:12px; }
.layout { display:grid; grid-template-columns:220px minmax(320px,1fr) 240px; gap:16px; align-items:start; }
.card { border:1px solid #dce2ec; border-radius:12px; background:#fff; box-shadow:0 2px 5px #172b4d04; overflow:hidden; }
.card-head { padding:17px 18px; border-bottom:1px solid #edf0f5; display:flex; justify-content:space-between; align-items:center; gap:10px; }
.card-body { padding:18px; }.stack { display:grid; gap:16px; }.count { color:#63728a; background:#eef2f8; padding:2px 8px; border-radius:12px; font-size:12px; }
label { display:block; font-size:12px; font-weight:600; color:#54647a; margin-bottom:7px; }
input,select,textarea { width:100%; border:1px solid #d5ddea; background:#fff; color:#182538; border-radius:7px; padding:9px 10px; }
textarea,pre,.mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; } textarea { min-height:156px; resize:vertical; font-size:13px; line-height:1.7; background:#fafbfd; tab-size:2; } textarea:disabled { color:#8490a1; }
.search { padding:14px 12px; }.actions { padding:0 7px 10px; max-height:570px; overflow:auto; }
.action { display:block; width:100%; text-align:left; border:1px solid transparent; background:transparent; border-radius:7px; padding:10px; margin:3px 0; overflow-wrap:anywhere; }
.action:hover,.run-item:hover { background:#f4f7fc; }.action[aria-pressed=true] { background:#edf3ff; color:#2056ce; border-color:#d6e3ff; }
.action strong { font-size:12px; display:block; }.action span { display:block; margin-top:4px; font-size:11px; color:#718198; }
.action-title { overflow-wrap:anywhere; font-family:ui-monospace,monospace; font-size:16px; }.description { margin-top:7px; color:#6a778b; font-size:12px; }
.field { margin-bottom:17px; }.hint { margin-top:6px; font-size:11px; color:#7b8798; }.toolbar { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.primary,.secondary { border-radius:7px; padding:8px 13px; font-size:12px; font-weight:600; border:1px solid #d9e0eb; background:white; color:#44566f; }
.primary { background:#225ce4; color:white; border-color:#225ce4; }.primary:hover { background:#174bc6; }.danger { color:#b33d45; }
.plain { border:0; background:transparent; color:#718198; padding:2px; font-size:11px; }.alert { color:#bb3447; font-size:12px; margin-top:10px; white-space:pre-wrap; }
.status { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:600; border-radius:5px; padding:3px 7px; background:#eef2f7; color:#68768d; }
.status::before { content:""; width:5px; height:5px; border-radius:50%; background:currentColor; }.status.success { background:#eaf6ef; color:#2a8057; }.status.error { background:#fff0f0; color:#b8444a; }.status.running { background:#edf2ff; color:#3565d5; }.status.cancelled { background:#fff5e7; color:#a46d22; }
pre { margin:0; font-size:12px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; background:#f7f9fc; border:1px solid #edf0f5; padding:14px; border-radius:7px; }
.empty { padding:32px 18px; color:#8793a5; text-align:center; font-size:12px; }.history { padding:8px; max-height:680px; overflow:auto; }
.run-item { width:100%; display:block; border:1px solid transparent; padding:11px 9px; background:transparent; border-radius:7px; margin:3px 0; text-align:left; }
.run-item[aria-pressed=true] { border-color:#d3dff7; background:#f6f9ff; }.run-item strong { display:block; font-size:12px; overflow-wrap:anywhere; margin:8px 0 4px; }.run-item small { font-size:10px; color:#8491a4; display:block; overflow-wrap:anywhere; }
.trace { padding:14px 18px 18px; max-height:500px; overflow:auto; } .trace ul { list-style:none; padding:0; margin:0; }.trace ul ul { margin-left:10px; padding-left:14px; border-left:1px solid #dce4f0; }
.trace li { margin:6px 0; }.trace summary { cursor:pointer; padding:7px 0; font-size:12px; overflow-wrap:anywhere; }.trace summary .status { margin:0 6px; }.trace pre { margin:5px 0 10px; font-size:11px; }
.trace-label { color:#6d7c92; font-size:10px; }.notice { color:#946a27; background:#fff8e9; border-radius:6px; padding:8px; margin:0 0 10px; font-size:11px; }.ids { font-size:10px; color:#8391a5; overflow-wrap:anywhere; margin-top:10px; }
.footer { display:flex; justify-content:space-between; gap:12px; margin-top:18px; font-size:11px; color:#8491a4; }
@media(max-width:1100px) { .layout { grid-template-columns:190px minmax(280px,1fr); }.history-card { grid-column:1/-1; }.history { display:flex; gap:6px; max-height:200px; }.run-item { min-width:190px; max-width:240px; }.app { padding:18px; } }
@media(max-width:650px) { .layout { display:flex; flex-direction:column; }.layout>* { width:100%; }.actions { max-height:190px; }.app { padding:12px; }.env { display:none; }.header { margin:10px 0 18px; }.footer { display:block; } }
`;

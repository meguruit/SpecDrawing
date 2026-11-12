import Link from "next/link";

// Mode-selection menu. Deliberately a server component with zero data
// loading: no scene / parts / finish-options fetch, no IndexedDB connection.
// Each mode owns its own bootstrapping on its own route.
const MODES = [
  {
    href: "/interior",
    title: "内観パースイメージ作成",
    body: "登録済みの内観ベースパースに、番号付き部材ごとの仕上げを当てて見せます。",
    detail: "部材リスト × 番号オーバーレイ × バリアント切替",
  },
  {
    href: "/exterior",
    title: "外観パース塗り分け",
    body: "ホワイトパースをアップロードし、塗り分け範囲を描いてジョリパッドカラーを当てます。",
    detail: "画像アップロード × ポリゴン塗り分け × ジョリパッドカラー",
  },
] as const;

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">SpecDrawing</h1>
        <p className="mt-1 text-sm text-slate-500">
          作成するイメージの種類を選んでください。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODES.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <span className="text-base font-semibold text-slate-900">
              {mode.title}
            </span>
            <span className="mt-2 flex-1 text-xs leading-relaxed text-slate-600">
              {mode.body}
            </span>
            <span className="mt-4 text-[10px] uppercase tracking-wide text-slate-400">
              {mode.detail}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

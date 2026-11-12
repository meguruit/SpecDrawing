import dynamic from "next/dynamic";

// The workspace touches IndexedDB and Konva, neither of which exists on the
// server, so the whole thing loads client-side behind one boundary.
const ExteriorWorkspace = dynamic(() => import("./ExteriorWorkspace.client"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-slate-400">
      読み込み中…
    </div>
  ),
});

export default function Page() {
  return <ExteriorWorkspace />;
}

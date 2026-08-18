"use client";

import { useExteriorStore, selectActiveProject } from "@/lib/exterior/store";
import { EXTRAS_CATEGORIES, emptyExtras } from "@/lib/exterior/types";

/**
 * Free-text specification for the exterior items that are not colour zoning —
 * lighting, signage, post, landscaping and so on.
 *
 * This records text. It calls no model and no service, and it does not touch
 * the rendered image. Saying so in the UI is deliberate: a prompt box next to
 * a canvas reads as "type here and the picture changes", and that expectation
 * is the most likely way this feature misleads someone.
 */
export function ExtrasBriefPanel() {
  const project = useExteriorStore(selectActiveProject);
  const setExtrasPrompt = useExteriorStore((s) => s.setExtrasPrompt);

  if (!project) return null;
  const extras = project.extras.length ? project.extras : emptyExtras();

  return (
    <section>
      <h2 className="text-xs font-semibold text-slate-900">その他外装</h2>
      <p className="mb-2 mt-1 rounded bg-slate-100 px-2 py-1 text-[10px] leading-relaxed text-slate-600">
        入力内容は<strong className="font-semibold">画像には反映されません</strong>。
        仕様書に記録されます。
      </p>

      <div className="space-y-2">
        {EXTRAS_CATEGORIES.map((category) => {
          const entry = extras.find((e) => e.category === category);
          return (
            <label key={category} className="block">
              <span className="text-[10px] font-medium text-slate-600">{category}</span>
              <textarea
                rows={2}
                value={entry?.prompt ?? ""}
                onChange={(e) => setExtrasPrompt(category, e.target.value)}
                placeholder="例: エントランス上部に間接照明、暖色 2700K"
                className="mt-0.5 w-full resize-y rounded border border-slate-300 px-2 py-1 text-[11px]"
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}

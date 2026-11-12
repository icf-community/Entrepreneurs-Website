"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Switch } from "@/components/forms/Switch";
import { Button } from "@/components/ui/Button";
import type { AiSettings, Concept } from "@/lib/ai/types";
import { previewMyProjection, saveAiSettings, type ProjectionPreviewItem } from "./actions";

// ════════════════════════════════════════════════════════════════════
// AI matching choices (AI-plan §1, §6, §12). Three separate permissions,
// each off until the member turns it on: being found by recruiters, being
// suggested to members building their network, and letting recruiters
// see lines quoted from your CV. Turning one off removes you from that
// search at once. One sentence each, with the detail on /ai-notice (F22).
// ════════════════════════════════════════════════════════════════════

const ROLE_TYPES = [
  ["internship", "Internship"], ["placement", "Placement"], ["graduate", "Graduate role"],
  ["part_time", "Part-time"], ["full_time", "Full-time"], ["contract", "Contract"], ["cofounder", "Co-founder"],
] as const;
const LOCATIONS = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On site"]] as const;

export default function AiSettingsCard({ initial, concepts }: { initial: AiSettings; concepts: Concept[] }) {
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ purpose: string; items: ProjectionPreviewItem[] } | null>(null);
  const [note, setNote] = useState(initial.selfReported);

  const save = async (next: AiSettings) => {
    const before = s;
    setS(next);
    setSaving(true);
    setError(null);
    try {
      const res = await saveAiSettings(next);
      if (!res.ok) { setS(before); setError(res.error); }
    } catch {
      setS(before);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async (purpose: "recruiter" | "network" | "self") => {
    const res = await previewMyProjection(purpose);
    if (res.ok) setPreview({ purpose, items: res.data });
    else setError(res.error);
  };

  return (
    <section id="ai" className="rounded-2xl border border-border bg-bg-card p-6">
      <h2 className="text-[0.95rem] font-medium text-text-primary">AI matching</h2>
      <p className="mt-1 text-[0.75rem] text-text-muted">
        Each choice is off until you turn it on. <Link href="/ai-notice" className="underline">How AI search uses your profile</Link>
      </p>
      <div className="mt-4 space-y-4">
        <Switch id="ai-recruiter" checked={s.recruiterDiscoverable} busy={saving}
          onChange={(v) => save({ ...s, recruiterDiscoverable: v })}
          label="Let recruiters find me" hint="Members who posted a job can see you in AI candidate search." />
        <Switch id="ai-network" checked={s.networkDiscoverable} busy={saving}
          onChange={(v) => save({ ...s, networkDiscoverable: v })}
          label="Suggest me to members building their network" hint="Members can find you by shared skills and interests." />
        <Switch id="ai-evidence" checked={s.evidenceSharing} busy={saving}
          onChange={(v) => save({ ...s, evidenceSharing: v })}
          label="Show recruiters lines from my CV" hint="Up to two short lines, only to recruiters who found you." />
        <Switch id="ai-memory" checked={s.useChatMemory} busy={saving}
          onChange={(v) => save({ ...s, useChatMemory: v })}
          label="Use my recent searches to understand new ones" hint="Your own searches from the last 7 days only." />
      </div>

      <div className="mt-6 space-y-4 border-t border-border-subtle pt-5">
        <TopicPicker label="I can help with" concepts={concepts} value={s.networkOffers} disabled={saving}
          onChange={(v) => save({ ...s, networkOffers: v })} />
        <TopicPicker label="I'd like help with" concepts={concepts} value={s.networkSeeks} disabled={saving}
          onChange={(v) => save({ ...s, networkSeeks: v })} />
        <Checks label="Jobs I'm interested in" options={ROLE_TYPES} value={s.prefRoleTypes} disabled={saving}
          onChange={(v) => save({ ...s, prefRoleTypes: v })} />
        <Checks label="Where I'd like to work" options={LOCATIONS} value={s.prefLocationTypes} disabled={saving}
          onChange={(v) => save({ ...s, prefLocationTypes: v })} />
        <div>
          <label htmlFor="ai-self-reported" className="text-[0.85rem] text-text-primary">Projects and experience</label>
          <p className="mt-0.5 text-[0.75rem] text-text-muted">Useful if you haven&apos;t uploaded a CV. Shown as self-reported.</p>
          <textarea id="ai-self-reported" rows={4} maxLength={1200} value={note} onChange={(e) => setNote(e.target.value)}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-[0.8rem] text-text-primary" />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[0.7rem] text-text-muted">{note.length}/1200</span>
            <Button size="sm" variant="ghost" loading={saving} disabled={note === s.selfReported}
              onClick={() => save({ ...s, selfReported: note })}>Save</Button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-border-subtle pt-5">
        <span className="w-full text-[0.75rem] text-text-muted">See exactly what AI search uses:</span>
        <Button variant="ghost" size="sm" onClick={() => showPreview("self")}>For my job matches</Button>
        {s.recruiterDiscoverable && <Button variant="ghost" size="sm" onClick={() => showPreview("recruiter")}>What recruiters search</Button>}
        {s.networkDiscoverable && <Button variant="ghost" size="sm" onClick={() => showPreview("network")}>What members search</Button>}
      </div>
      {preview && (
        <div className="mt-3 rounded-lg border border-border p-3">
          {preview.items.length === 0 ? (
            <p className="text-[0.8rem] text-text-muted">Nothing yet. It updates a few minutes after you change your profile.</p>
          ) : (
            <ul className="space-y-1.5">
              {preview.items.map((item) => (
                <li key={`${item.kind}:${item.text}`} className="text-[0.8rem] text-text-secondary">
                  {item.text}{item.fromCv && <span className="text-text-muted"> · from your CV</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}
    </section>
  );
}

function TopicPicker({
  label, concepts, value, disabled, onChange,
}: { label: string; concepts: Concept[]; value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState("");
  const byslug = useMemo(() => new Map(concepts.map((c) => [c.slug, c])), [concepts]);
  const matches = query.trim().length < 2 ? [] : concepts
    // react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply
    .filter((c) => !value.includes(c.slug) && c.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  const inputId = `topic-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={inputId} className="text-[0.85rem] text-text-primary">{label}</label>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {value.map((slug) => (
          <li key={slug} className="inline-flex items-center gap-1 rounded-lg border border-border-strong px-2 py-1 text-[0.75rem] text-text-secondary">
            {byslug.get(slug)?.label ?? slug}
            <button type="button" disabled={disabled} aria-label={`Remove ${byslug.get(slug)?.label ?? slug}`}
              className="cursor-pointer rounded border border-border-strong px-1.5 text-[0.7rem] hover:border-accent"
              onClick={() => onChange(value.filter((v) => v !== slug))}>×</button>
          </li>
        ))}
      </ul>
      {value.length < 10 && (
        <>
          <input id={inputId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics"
            className="mt-2 w-full rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-[0.8rem] text-text-primary" />
          {matches.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {matches.map((c) => (
                <li key={c.slug}>
                  <button type="button" disabled={disabled}
                    className="cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-2.5 py-1 text-[0.75rem] text-text-secondary hover:border-accent"
                    onClick={() => { onChange([...value, c.slug]); setQuery(""); }}>
                    + {c.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Checks({
  label, options, value, disabled, onChange,
}: {
  label: string;
  options: readonly (readonly [string, string])[];
  value: string[];
  disabled: boolean;
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[0.85rem] text-text-primary">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-3 text-[0.8rem] text-text-secondary">
        {options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5">
            {/* react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply */}
            <input type="checkbox" disabled={disabled} checked={value.includes(v)}
              onChange={(e) => onChange(e.target.checked ? [...value, v] : value.filter((x) => x !== v))} />
            {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

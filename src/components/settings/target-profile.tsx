"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rankWeights, DEFAULT_PROFILE, type TargetProfile } from "@/lib/profile";

/**
 * Editor for the target profile — the configurable replacement for the persona
 * that used to be hardcoded inside the ranking prompt.
 *
 * Design rules this UI has to respect:
 * - Every knob is editable here; nothing about the seeker lives in source.
 * - Weights are shown with their normalised effective value, because the
 *   ranker normalises them (so the user can see what they actually get).
 * - "Widen search" is on by default and explained: a profile expresses
 *   preference, never exclusion.
 */

interface Props {
  value: TargetProfile;
  onChange: (profile: TargetProfile) => void;
}

const WORK_TOGGLES: { key: keyof TargetProfile["work"]; label: string }[] = [
  { key: "acceptOnSite", label: "On-site" },
  { key: "acceptRemote", label: "Remote" },
  { key: "acceptHybrid", label: "Hybrid" },
  { key: "acceptWeekends", label: "Weekends" },
  { key: "acceptEvenings", label: "Evenings" },
  { key: "acceptHolidays", label: "Holidays" },
  { key: "acceptFullTime", label: "Full-time (W-2)" },
  { key: "acceptContract", label: "Contract" },
  { key: "acceptFreelance", label: "Freelance" },
  { key: "acceptPerEvent", label: "Per-event / gig" },
  { key: "acceptTemporary", label: "Temporary" },
  { key: "acceptPartTime", label: "Part-time" },
];

const WEIGHT_FIELDS: { key: keyof TargetProfile["weights"]; label: string; hint: string }[] = [
  { key: "pay", label: "Pay", hint: "Rate quality for the work" },
  { key: "interest", label: "Interest", hint: "How well the work matches your interests" },
  { key: "responsibility", label: "Responsibility", hint: "How much the duties appeal and fit you" },
  { key: "hours", label: "Hours", hint: "Weekly volume against your minimum" },
  { key: "flexibility", label: "Flexibility", hint: "Scheduling freedom / remote" },
  { key: "location", label: "Location", hint: "Commute and relocation desirability" },
  { key: "requirements", label: "Accessibility", hint: "Credential / portfolio gates" },
  { key: "engagement", label: "Engagement", hint: "W-2 vs contract vs per-event fit" },
];

const csv = (list: string[]) => list.join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const numOrNull = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function TargetProfileEditor({ value, onChange }: Props) {
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  const p = value;
  const set = (patch: Partial<TargetProfile>) => onChange({ ...p, ...patch });
  const setWork = (patch: Partial<TargetProfile["work"]>) =>
    onChange({ ...p, work: { ...p.work, ...patch } });
  const setComp = (patch: Partial<TargetProfile["compensation"]>) =>
    onChange({ ...p, compensation: { ...p.compensation, ...patch } });
  const setLoc = (patch: Partial<TargetProfile["location"]>) =>
    onChange({ ...p, location: { ...p.location, ...patch } });
  const setReq = (patch: Partial<TargetProfile["requirements"]>) =>
    onChange({ ...p, requirements: { ...p.requirements, ...patch } });
  const setWeights = (patch: Partial<TargetProfile["weights"]>) =>
    onChange({ ...p, weights: { ...p.weights, ...patch } });

  const effective = rankWeights(p);
  const weightTotal = (Object.values(p.weights) as number[]).reduce((s, n) => s + Number(n || 0), 0);

  function openRaw() {
    setRawText(JSON.stringify(p, null, 2));
    setRawError(null);
    setRawMode(true);
  }

  function applyRaw() {
    try {
      const parsed = JSON.parse(rawText);
      onChange({ ...DEFAULT_PROFILE, ...parsed } as TargetProfile);
      setRawError(null);
      setRawMode(false);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Target Profile</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              What a good job looks like for you. This drives the ranking — nothing about you is
              hardcoded in the app. Preferences never hide a job: listings that miss something stay
              in the list, flagged.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => (rawMode ? setRawMode(false) : openRaw())}>
            {rawMode ? "Guided editor" : "Edit raw JSON"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {rawMode ? (
          <div className="space-y-2">
            <Label htmlFor="profileRaw">Profile JSON</Label>
            <Textarea
              id="profileRaw"
              className="min-h-[320px] font-mono text-xs"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            {rawError && <p className="text-xs text-destructive">{rawError}</p>}
            <Button size="sm" onClick={applyRaw}>
              Apply JSON
            </Button>
          </div>
        ) : (
          <>
            {/* ── Interests ─────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="pInterests">Interests (comma separated)</Label>
                <Input
                  id="pInterests"
                  value={csv(p.interests)}
                  onChange={(e) => set({ interests: parseCsv(e.target.value) })}
                  placeholder="photography, videography, dj, live events, wedding"
                />
                <p className="text-xs text-muted-foreground">
                  The relevance signal. Titles and descriptions are matched against these.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pIndustries">Industries (comma separated — leave blank for any)</Label>
                <Input
                  id="pIndustries"
                  value={csv(p.industries)}
                  onChange={(e) => set({ industries: parseCsv(e.target.value) })}
                  placeholder="blank = not picky about industry"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pIncludeRoles">Role terms that usually fit (advisory)</Label>
                <Input
                  id="pIncludeRoles"
                  value={csv(p.roles.include)}
                  onChange={(e) => set({ roles: { ...p.roles, include: parseCsv(e.target.value) } })}
                />
              </div>
            </div>

            {/* ── Hours rule ────────────────────────────────────────────── */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Weekly hours</p>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="pMinHours">Minimum hours / week</Label>
                  <Input
                    id="pMinHours"
                    type="number"
                    min={0}
                    max={80}
                    className="w-28"
                    value={p.work.minWeeklyHours}
                    onChange={(e) => setWork({ minWeeklyHours: Number(e.target.value) })}
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.work.requireJustificationBelowMinHours}
                    onChange={(e) => setWork({ requireJustificationBelowMinHours: e.target.checked })}
                  />
                  Below the minimum is acceptable when remote or flexible
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                A short week without remote work or scheduling flexibility loses points — it is
                still ranked and shown, never removed.
              </p>
            </div>

            {/* ── Pay ───────────────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Compensation</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  ["floorHourly", "Floor / hr", "floorAnnual", "Floor / yr"],
                  ["targetHourly", "Target / hr", "targetAnnual", "Target / yr"],
                  ["stretchHourly", "Stretch / hr", "stretchAnnual", "Stretch / yr"],
                ] as const).map(([hKey, hLabel, aKey, aLabel]) => (
                  <div key={hKey} className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor={`p-${hKey}`}>{hLabel}</Label>
                      <Input
                        id={`p-${hKey}`}
                        type="number"
                        placeholder="unset"
                        value={p.compensation[hKey] ?? ""}
                        onChange={(e) => setComp({ [hKey]: numOrNull(e.target.value) } as never)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`p-${aKey}`}>{aLabel}</Label>
                      <Input
                        id={`p-${aKey}`}
                        type="number"
                        placeholder="unset"
                        value={p.compensation[aKey] ?? ""}
                        onChange={(e) => setComp({ [aKey]: numOrNull(e.target.value) } as never)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.compensation.acceptPerEventPay}
                    onChange={(e) => setComp({ acceptPerEventPay: e.target.checked })}
                  />
                  Per-event / flat-rate pay is fine
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.compensation.requirePaidTravel}
                    onChange={(e) => setComp({ requirePaidTravel: e.target.checked })}
                  />
                  Unpaid travel/editing is a dealbreaker
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave pay blank and rates are scored against what the work pays in your market
                instead of pass/fail — nothing is hidden for lacking a number.
              </p>
            </div>

            {/* ── Willingness ───────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Work you will take</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {WORK_TOGGLES.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(p.work[key])}
                      onChange={(e) => setWork({ [key]: e.target.checked } as never)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* ── Location ──────────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Market</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="pCity">City</Label>
                  <Input id="pCity" value={p.location.city} onChange={(e) => setLoc({ city: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pState">State</Label>
                  <Input id="pState" value={p.location.state} onChange={(e) => setLoc({ state: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pCol">Cost-of-living index</Label>
                  <Input
                    id="pCol"
                    type="number"
                    value={p.location.colIndex}
                    onChange={(e) => setLoc({ colIndex: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pCommute">Commute tolerance (min)</Label>
                  <Input
                    id="pCommute"
                    type="number"
                    value={p.location.maxCommuteMinutes}
                    onChange={(e) => setLoc({ maxCommuteMinutes: Number(e.target.value) })}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.location.acceptOutOfState}
                  onChange={(e) => setLoc({ acceptOutOfState: e.target.checked })}
                />
                Out-of-state roles are in scope on merit
              </label>
            </div>

            {/* ── Requirements / you ────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-sm font-medium">About you</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="pDegree">College degree</Label>
                  <select
                    id="pDegree"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={p.requirements.hasCollegeDegree === null ? "unset" : p.requirements.hasCollegeDegree ? "yes" : "no"}
                    onChange={(e) =>
                      setReq({
                        hasCollegeDegree:
                          e.target.value === "unset" ? null : e.target.value === "yes",
                      })
                    }
                  >
                    <option value="unset">Not specified</option>
                    <option value="no">No degree</option>
                    <option value="yes">Has a degree</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pYears">Years of experience</Label>
                  <Input
                    id="pYears"
                    type="number"
                    placeholder="unset"
                    value={p.requirements.yearsExperience ?? ""}
                    onChange={(e) => setReq({ yearsExperience: numOrNull(e.target.value) })}
                  />
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.requirements.hasPortfolio}
                    onChange={(e) => setReq({ hasPortfolio: e.target.checked })}
                  />
                  Portfolio / reel available
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pGear">Gear you own (comma separated)</Label>
                  <Input
                    id="pGear"
                    value={csv(p.requirements.ownGear)}
                    onChange={(e) => setReq({ ownGear: parseCsv(e.target.value) })}
                    placeholder="camera, lens set, lighting, DJ controller"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pCerts">Certifications (comma separated)</Label>
                  <Input
                    id="pCerts"
                    value={csv(p.requirements.certifications)}
                    onChange={(e) => setReq({ certifications: parseCsv(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            {/* ── Weights ───────────────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">What matters most</p>
                <p className="text-xs text-muted-foreground">
                  Raw total {weightTotal.toFixed(2)} · normalised automatically
                </p>
              </div>
              <div className="space-y-2">
                {WEIGHT_FIELDS.map(({ key, label, hint }) => (
                  <div key={key} className="flex items-center gap-3">
                    <Label htmlFor={`w-${key}`} className="w-40 shrink-0 text-sm">
                      {label}
                      <span className="block text-xs font-normal text-muted-foreground">{hint}</span>
                    </Label>
                    <Input
                      id={`w-${key}`}
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      className="w-24"
                      value={p.weights[key]}
                      onChange={(e) => setWeights({ [key]: Number(e.target.value) } as never)}
                    />
                    <span className="text-xs text-muted-foreground">
                      → {Math.round((effective[key] ?? 0) * 100)}% of the score
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Search breadth ────────────────────────────────────────── */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={p.scoring.widenSearch}
                  onChange={(e) => set({ scoring: { ...p.scoring, widenSearch: e.target.checked } })}
                />
                Widen the search — keep roles that don&apos;t match my explicit interests
              </label>
              <p className="text-xs text-muted-foreground">
                Recommended. Roles outside your stated interests are still scored and shown when
                their pay, responsibility or growth looks good — they are flagged, not dropped.
              </p>
              <div className="space-y-1 pt-1">
                <Label htmlFor="pMinDisplay">Only highlight scores at or above (display only)</Label>
                <Input
                  id="pMinDisplay"
                  type="number"
                  min={0}
                  max={100}
                  className="w-28"
                  value={p.scoring.minDisplayScore}
                  onChange={(e) =>
                    set({ scoring: { ...p.scoring, minDisplayScore: Number(e.target.value) } })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Affects badges and alerts only — it never deletes a listing.
                </p>
              </div>
            </div>

            {/* ── Free-text instructions ────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="pNotes">Extra instructions for the ranker (optional)</Label>
              <Textarea
                id="pNotes"
                value={p.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Anything else that should influence scoring — passed to the model verbatim."
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Alert } from "../ui/alert";
import { Dialog, DialogContent } from "../ui/dialog";

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  maxLength?: number;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}

export function ReasonDialog({ open, title, description, submitLabel, maxLength = 2000, onCancel, onSubmit }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = reason.trim();
    if (value.length < 3) {
      setError("Enter at least 3 characters to explain this action.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await onSubmit(value);
      if (!saved) setError("The action could not be saved. Review the message and try again.");
    } catch {
      setError("The action could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }} ariaLabel={title}>
      {open && <DialogContent className="w-[min(100vw-2rem,30rem)]">
        <form onSubmit={submit}>
          <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
          <label className="mt-5 block text-sm font-semibold text-stone-800" htmlFor="examguard-review-reason">Reason
            <Textarea
              id="examguard-review-reason"
              autoFocus
              required
              minLength={3}
              maxLength={maxLength}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 font-normal"
            />
          </label>
          {error && <Alert variant="destructive" className="mt-2">{error}</Alert>}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Saving…" : submitLabel}</Button>
          </div>
        </form>
      </DialogContent>}
    </Dialog>
  );
}

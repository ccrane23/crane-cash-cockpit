// "Safe to Spend" — how much of the TD Business Simple Checking (8793) balance
// is genuinely free after the fixed bills still due before the next paycheck.
//
// Pay is twice monthly, splitting the month into two buckets keyed to pay dates:
//   Bucket A: 3rd–17th   (next paycheck the 18th)
//   Bucket B: 18th–2nd   (next paycheck the 3rd — wraps into next month)
//
// Stage 1 is a date-based approximation: a bill is treated as "still due" while
// today is on/before its due date, and as cleared once that date has passed.
// No transaction matching yet.

export type Bucket = "A" | "B";

export type Bill = {
  name: string;
  bucket: Bucket;
  amount: number; // positive dollars
  dueDay: number; // day-of-month the bill posts
};

// Fixed monthly bills by pay-period bucket. Amounts in dollars.
export const BILLS: Bill[] = [
  // Bucket A — paid out of the 3rd-of-month paycheck.
  { name: "VSP Vision", bucket: "A", amount: 29, dueDay: 3 },
  { name: "Mortgage", bucket: "A", amount: 6672.5, dueDay: 3 },
  { name: "Dental insurance", bucket: "A", amount: 130.64, dueDay: 3 },
  { name: "Medical insurance", bucket: "A", amount: 281.02, dueDay: 3 },
  { name: "OUC", bucket: "A", amount: 180, dueDay: 3 },
  { name: "Sophia's volleyball", bucket: "A", amount: 340, dueDay: 3 },
  { name: "Olivia's Cheer #1", bucket: "A", amount: 380, dueDay: 3 },
  { name: "Cleaning", bucket: "A", amount: 600, dueDay: 3 },

  // Bucket B — paid out of the 18th-of-month paycheck.
  { name: "Solar", bucket: "B", amount: 443, dueDay: 18 },
  { name: "Olivia's Cheer #2", bucket: "B", amount: 195, dueDay: 18 },
  { name: "Life insurance", bucket: "B", amount: 500, dueDay: 18 },
  { name: "Retirement investment", bucket: "B", amount: 1000, dueDay: 18 },
  { name: "Auto insurance", bucket: "B", amount: 300.32, dueDay: 18 },
  { name: "Cell phones", bucket: "B", amount: 387.95, dueDay: 18 },
  { name: "Casey's car", bucket: "B", amount: 1650, dueDay: 18 },
  { name: "Kiki's car", bucket: "B", amount: 1438.26, dueDay: 18 },
];

export type SafeToSpend = {
  bucket: Bucket;
  tdBalance: number;
  billsStillDue: Bill[];
  billsRemainingTotal: number;
  safeToSpend: number;
  nextPayday: string; // YYYY-MM-DD
  daysUntilPayday: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Round to whole cents, avoiding binary-float drift on sums. */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 'A' for the 3rd–17th, 'B' for the 18th through the 2nd of next month. */
export function getCurrentBucket(date: Date = new Date()): Bucket {
  const d = date.getDate();
  return d >= 3 && d <= 17 ? "A" : "B";
}

/**
 * The next pay date and how many days away it is.
 *   Bucket A -> the 18th of this month.
 *   Bucket B -> the 3rd (next month if we're on/after the 18th, this month if
 *               we've already wrapped to the 1st–2nd).
 */
export function getNextPayday(date: Date = new Date()): {
  date: string;
  daysUntil: number;
} {
  const y = date.getFullYear();
  const m = date.getMonth();
  let pay: Date;

  if (getCurrentBucket(date) === "A") {
    pay = new Date(y, m, 18);
  } else if (date.getDate() >= 18) {
    pay = new Date(y, m + 1, 3); // wraps the year automatically when m === 11
  } else {
    pay = new Date(y, m, 3);
  }

  const daysUntil = Math.round((pay.getTime() - startOfDay(date).getTime()) / MS_PER_DAY);
  return { date: toISO(pay), daysUntil };
}

/**
 * The actual calendar date a bill posts within the current pay period. For
 * Bucket B viewed from the wrapped 1st–2nd, that's the 18th of the *previous*
 * month (already past), which is what makes those bills read as cleared.
 */
function billDueDate(bill: Bill, date: Date): Date {
  const y = date.getFullYear();
  const m = date.getMonth();
  if (bill.bucket === "B" && date.getDate() < 18) {
    return new Date(y, m - 1, bill.dueDay);
  }
  return new Date(y, m, bill.dueDay);
}

export function computeSafeToSpend(
  tdBalance: number,
  date: Date = new Date(),
): SafeToSpend {
  const bucket = getCurrentBucket(date);
  const today = startOfDay(date);

  const billsStillDue = BILLS.filter(
    (b) => b.bucket === bucket && billDueDate(b, date).getTime() >= today.getTime(),
  );

  const billsRemainingTotal = roundCents(
    billsStillDue.reduce((sum, b) => sum + b.amount, 0),
  );
  const safeToSpend = roundCents(tdBalance - billsRemainingTotal);
  const { date: nextPayday, daysUntil: daysUntilPayday } = getNextPayday(date);

  return {
    bucket,
    tdBalance: roundCents(tdBalance),
    billsStillDue,
    billsRemainingTotal,
    safeToSpend,
    nextPayday,
    daysUntilPayday,
  };
}

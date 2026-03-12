const fs = require("fs");

function getShiftDuration(startTime, endTime) {
    const toSeconds = (timeStr) => {
        const parts = timeStr.trim().split(" ");
        const [h, m, s] = parts[0].split(":").map(Number);
        const period = parts[1].toLowerCase();
        let hours = h;
        if (period === "am" && hours === 12) hours = 0;
        if (period === "pm" && hours !== 12) hours += 12;
        return hours * 3600 + m * 60 + s;
    };
    const diff = toSeconds(endTime) - toSeconds(startTime);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Converts both AM/PM times to total seconds, then computes the difference.
// Returns the result as h:mm:ss, so a single-digit hour is not zero-padded.

function getIdleTime(startTime, endTime) {
    const toSeconds = (timeStr) => {
        const parts = timeStr.trim().split(" ");
        const [h, m, s] = parts[0].split(":").map(Number);
        const period = parts[1].toLowerCase();
        let hours = h;
        if (period === "am" && hours === 12) hours = 0;
        if (period === "pm" && hours !== 12) hours += 12;
        return hours * 3600 + m * 60 + s;
    };
    const DELIVERY_START = 8 * 3600;
    const DELIVERY_END = 22 * 3600;
    const start = toSeconds(startTime);
    const end = toSeconds(endTime);
    let idle = 0;
    if (start < DELIVERY_START) idle += Math.min(DELIVERY_START, end) - start;
    if (end > DELIVERY_END) idle += end - Math.max(DELIVERY_END, start);
    const h = Math.floor(idle / 3600);
    const m = Math.floor((idle % 3600) / 60);
    const s = idle % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Delivery window is 08:00–22:00; any time outside that window is idle.
// Handles edge cases where the entire shift is inside or outside the window.

function getActiveTime(shiftDuration, idleTime) {
    const toSeconds = (timeStr) => {
        const [h, m, s] = timeStr.trim().split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };
    const diff = toSeconds(shiftDuration) - toSeconds(idleTime);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Simply subtracts idleTime seconds from shiftDuration seconds.
// When idleTime is 0:00:00 the result equals shiftDuration unchanged.

function metQuota(date, activeTime) {
    const toSeconds = (timeStr) => {
        const [h, m, s] = timeStr.trim().split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };
    const [year, month, day] = date.split("-").map(Number);
    const EID_START = { year: 2025, month: 4, day: 10 };
    const EID_END = { year: 2025, month: 4, day: 30 };
    const isEid =
        year === EID_START.year &&
        month === EID_START.month &&
        day >= EID_START.day &&
        day <= EID_END.day;
    const quota = isEid ? 6 * 3600 : 8 * 3600 + 24 * 60;
    return toSeconds(activeTime) >= quota;
}
// Eid al-Fitr 2025 runs April 10–30, reducing the daily quota to 6 hours.
// On normal days the quota is 8 hours and 24 minutes (8 * 3600 + 24 * 60).

function addShiftRecord(textFile, shiftObj) {
    const { driverID, driverName, date, startTime, endTime } = shiftObj;
    let content = "";
    try { content = fs.readFileSync(textFile, "utf8"); } catch (e) { content = ""; }
    const lines = content.split("\n").filter(l => l.trim() !== "");
    for (const line of lines) {
        const cols = line.split(",");
        if (cols[0].trim() === driverID && cols[2].trim() === date) return {};
    }
    const shiftDuration = getShiftDuration(startTime, endTime);
    const idleTime = getIdleTime(startTime, endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quota = metQuota(date, activeTime);
    const newRecord = `${driverID},${driverName},${date},${startTime},${endTime},${shiftDuration},${idleTime},${activeTime},${quota},false`;
    let insertIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].split(",")[0].trim() === driverID) { insertIndex = i; break; }
    }
    if (insertIndex === -1) {
        lines.push(newRecord);
    } else {
        lines.splice(insertIndex + 1, 0, newRecord);
    }
    fs.writeFileSync(textFile, lines.join("\n") + "\n", "utf8");
    return { driverID, driverName, date, startTime, endTime, shiftDuration, idleTime, activeTime, metQuota: quota, hasBonus: false };
}
// Returns {} immediately if a record with the same driverID + date already exists.
// New records for an existing driver are inserted after that driver's last entry.

function setBonus(textFile, driverID, date, newValue) {
    let content = fs.readFileSync(textFile, "utf8");
    const lines = content.split("\n");
    const updated = lines.map(line => {
        const cols = line.split(",");
        if (cols[0] && cols[0].trim() === driverID && cols[2] && cols[2].trim() === date) {
            cols[9] = String(newValue);
            return cols.join(",");
        }
        return line;
    });
    fs.writeFileSync(textFile, updated.join("\n"), "utf8");
}
// Locates the correct row by matching both driverID and date columns.
// Writes the modified content back to the file in place without returning anything.

function countBonusPerMonth(textFile, driverID, month) {
    const content = fs.readFileSync(textFile, "utf8");
    const lines = content.split("\n").filter(l => l.trim() !== "");
    const targetMonth = parseInt(month, 10);
    let found = false;
    let count = 0;
    for (const line of lines) {
        const cols = line.split(",");
        if (cols[0].trim() !== driverID) continue;
        found = true;
        const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
        if (recordMonth === targetMonth && cols[9] && cols[9].trim() === "true") count++;
    }
    return found ? count : -1;
}
// Normalises the month string with parseInt so "4" and "04" both match April.
// Returns -1 only when the driverID is completely absent from the file.

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const content = fs.readFileSync(textFile, "utf8");
    const lines = content.split("\n").filter(l => l.trim() !== "");
    let totalSeconds = 0;
    for (const line of lines) {
        const cols = line.split(",");
        if (cols[0].trim() !== driverID) continue;
        const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
        if (recordMonth !== month) continue;
        const [h, m, s] = cols[7].trim().split(":").map(Number);
        totalSeconds += h * 3600 + m * 60 + s;
    }
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Sums activeTime (column index 7) across all matching rows, including day-off shifts.
// Output uses a three-digit hour field (hhh) to accommodate totals above 99 hours.

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const shiftContent = fs.readFileSync(textFile, "utf8");
    const rateContent = fs.readFileSync(rateFile, "utf8");
    const shiftLines = shiftContent.split("\n").filter(l => l.trim() !== "");
    const rateLines = rateContent.split("\n").filter(l => l.trim() !== "");

    let dayOff = null;
    for (const line of rateLines) {
        const cols = line.split(",");
        if (cols[0].trim() === driverID) { dayOff = cols[1].trim().toLowerCase(); break; }
    }

    const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const EID_START = new Date(2025, 3, 10);
    const EID_END = new Date(2025, 3, 30);

    let totalSeconds = 0;
    for (const line of shiftLines) {
        const cols = line.split(",");
        if (cols[0].trim() !== driverID) continue;
        const dateStr = cols[2].trim();
        const [year, mon, day] = dateStr.split("-").map(Number);
        if (mon !== month) continue;
        const dateObj = new Date(year, mon - 1, day);
        const dayName = DAY_NAMES[dateObj.getDay()];
        if (dayName === dayOff) continue;
        const isEid = dateObj >= EID_START && dateObj <= EID_END;
        const quota = isEid ? 6 * 3600 : 8 * 3600 + 24 * 60;
        totalSeconds += quota;
    }

    const bonusReduction = bonusCount * 2 * 3600;
    totalSeconds = Math.max(0, totalSeconds - bonusReduction);

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Skips any shift that falls on the driver's designated day off before summing quotas.
// Each bonus in the given month reduces the total required hours by exactly 2 hours.

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const toSeconds = (timeStr) => {
        const [h, m, s] = timeStr.trim().split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };
    const content = fs.readFileSync(rateFile, "utf8");
    const lines = content.split("\n").filter(l => l.trim() !== "");
    let basePay = 0, tier = 0;
    for (const line of lines) {
        const cols = line.split(",");
        if (cols[0].trim() === driverID) { basePay = parseInt(cols[2].trim(), 10); tier = parseInt(cols[3].trim(), 10); break; }
    }
    const ALLOWED = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const allowedSeconds = (ALLOWED[tier] || 0) * 3600;
    const actualSec = toSeconds(actualHours);
    const requiredSec = toSeconds(requiredHours);
    const rawMissing = Math.max(0, requiredSec - actualSec);
    const billableMissing = Math.max(0, rawMissing - allowedSeconds);
    const billableHours = Math.floor(billableMissing / 3600);
    const deductionRatePerHour = Math.floor(basePay / 185);
    const salaryDeduction = billableHours * deductionRatePerHour;
    return basePay - salaryDeduction;
}
// Tier-based allowance is subtracted before computing billable missing hours.
// Only full hours count toward the deduction; fractional hours are discarded with Math.floor.

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
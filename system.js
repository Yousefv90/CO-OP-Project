/* =====================================================
   نظام إجازات الفريق - واجهات التطبيق
   (حجز إجازة، طلباتي، الرصيد، التقويم، الموافقات)
   ===================================================== */

// أنواع الإجازات وألوانها
const LEAVE_TYPES = {
  annual:      { label: "سنوية",    color: "#3b82f6" },
  sick:        { label: "مرضية",    color: "#ef4444" },
  marriage:    { label: "زواج",     color: "#ec4899" },
  bereavement: { label: "وفاة",     color: "#6b7280" },
  maternity:   { label: "أمومة",    color: "#a855f7" },
  paternity:   { label: "أبوة",     color: "#14b8a6" },
  emergency:   { label: "طارئة",    color: "#f59e0b" },
  unpaid:      { label: "بدون راتب", color: "#64748b" }
};

const STATUS = {
  pending:  { label: "قيد الموافقة", cls: "st-pending" },
  approved: { label: "مقبولة",       cls: "st-approved" },
  rejected: { label: "مرفوضة",       cls: "st-rejected" }
};

const esc = (s) => String(s).replace(/</g, "&lt;");
const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("ar");
const daysBetween = (a, b) =>
  Math.floor((new Date(b) - new Date(a)) / 86400000) + 1;

let calMonth = new Date();

/* ===== التنقل بين الأقسام ===== */

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["home", "balance", "calendar", "approvals"].forEach(s =>
      document.getElementById("sec-" + s).style.display = s === btn.dataset.sec ? "block" : "none");
    if (btn.dataset.sec === "calendar") renderCalendar();
    if (btn.dataset.sec === "approvals") renderApprovals();
  });
});

/* ===== حجز إجازة ===== */

function systemInit() {
  // تعبئة أنواع الإجازة
  $("lvType").innerHTML = Object.entries(LEAVE_TYPES)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  loadMyLeaves();
}

function updateDays() {
  const s = $("lvStart").value, e = $("lvEnd").value;
  $("lvDays").value = (s && e && e >= s) ? daysBetween(s, e) : 0;
}
$("lvStart").addEventListener("change", updateDays);
$("lvEnd").addEventListener("change", updateDays);

$("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("leaveError").textContent = "";

  const type = $("lvType").value;
  const start = $("lvStart").value;
  const end = $("lvEnd").value;

  if (!start || !end) { $("leaveError").textContent = "اختر تاريخ البداية والنهاية"; return; }
  if (end < start) { $("leaveError").textContent = "تاريخ النهاية قبل البداية"; return; }

  // رفع المرفق إن اختير (يتطلب Firebase Storage)
  let attachmentUrl = "";
  const attFile = $("lvAttachment").files[0];
  if (attFile) {
    if (!useFirebase) { $("leaveError").textContent = "إرفاق الملف متاح فقط مع Firebase"; return; }
    if (attFile.size > 5 * 1024 * 1024) { $("leaveError").textContent = "حجم الملف أكبر من 5 ميجابايت"; return; }
    try {
      const path = "attachments/" + Date.now() + "_" + attFile.name.replace(/[^\w.\-]/g, "_");
      const ref = firebase.storage().ref().child(path);
      await ref.put(attFile);
      attachmentUrl = await ref.getDownloadURL();
    } catch (err) {
      $("leaveError").textContent = "تعذر رفع المرفق (تأكد من قواعد Firebase Storage)";
      return;
    }
  }
  await saveLeave({
    email: currentUser.email,
    employee_name: currentUser.name,
    team: currentUser.team,
    leave_type: type,
    start_date: start,
    end_date: end,
    total_days: daysBetween(start, end),
    comments: $("lvComments").value.trim(),
    attachment_url: attachmentUrl,
    status: "pending",
    decided_by: ""
  });

  $("leaveForm").reset();
  $("lvDays").value = "0";
  loadMyLeaves();
  alert("تم إرسال الطلب للموافقة");
});

/* ===== طلباتي ===== */

async function loadMyLeaves() {
  const leaves = (await getAllLeaves()).filter(l => l.email === currentUser.email);
  const tbody = $("myLeavesTable").querySelector("tbody");
  tbody.innerHTML = "";
  $("myLeavesEmpty").style.display = leaves.length ? "none" : "block";

  leaves.forEach(l => {
    const t = LEAVE_TYPES[l.leave_type] || { label: l.leave_type, color: "#888" };
    const st = STATUS[l.status] || { label: l.status, cls: "" };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="dot" style="background:${t.color}"></span>${t.label}</td>
      <td>${fmt(l.start_date)}</td>
      <td>${fmt(l.end_date)}</td>
      <td>${l.total_days}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>${l.attachment_url ? `<a class="btn ghost small" href="${l.attachment_url}" target="_blank" rel="noopener">المرفق</a> ` : ""}${l.status === "pending" ? `<button class="btn ghost small" data-cancel="${l.id}">إلغاء</button>` : ""}</td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-cancel]").forEach(btn =>
    btn.addEventListener("click", async () => { await deleteLeave(btn.dataset.cancel); loadMyLeaves(); }));

  renderBalances(leaves);
}

/* ===== الرصيد ===== */

function renderBalances(myLeaves) {
  const year = new Date().getFullYear();
  const box = $("balancesBox");
  box.innerHTML = "";
  [["annual", "الإجازات السنوية"], ["sick", "الإجازات المرضية"]].forEach(([key, title]) => {
    const used = myLeaves
      .filter(l => l.leave_type === key && l.status === "approved" && l.start_date.startsWith(year))
      .reduce((s, l) => s + Number(l.total_days || 0), 0);
    const total = BALANCE[key];
    const remain = total - used;
    const pct = Math.min(100, Math.round((used / total) * 100));
    box.innerHTML += `
      <div class="balance-card">
        <h3>${title}</h3>
        <div class="balance-nums"><strong>${remain}</strong> متبقي من ${total} يوم</div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="subtitle">مستخدم: ${used} يوم</div>
      </div>`;
  });
}

/* ===== التقويم ===== */

$("calPrev").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$("calNext").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });

async function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $("calLabel").textContent = calMonth.toLocaleDateString("ar", { month: "long", year: "numeric" });

  // مفتاح الألوان
  $("legend").innerHTML = Object.entries(LEAVE_TYPES)
    .map(([k, v]) => `<span class="lg-item"><span class="dot" style="background:${v.color}"></span>${v.label}</span>`)
    .join("") + `<span class="lg-item"><span class="dot dashed"></span>قيد الموافقة</span>`;

  const leaves = (await getAllLeaves()).filter(l => l.team === currentUser.team);
  const first = new Date(y, m, 1);
  const startPad = first.getDay(); // الأحد = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const weekdays = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
  let html = weekdays.map(w => `<div class="cal-wd">${w}</div>`).join("");
  html += "<div></div>".repeat(startPad);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayLeaves = leaves.filter(l => l.start_date <= dateStr && dateStr <= l.end_date);
    const chips = dayLeaves.slice(0, 3).map(l => {
      const t = LEAVE_TYPES[l.leave_type] || { color: "#888" };
      return `<span class="chip ${l.status === "pending" ? "chip-pending" : ""}"
        style="background:${t.color}">${esc(l.employee_name)}</span>`;
    }).join("");
    const more = dayLeaves.length > 3 ? `<span class="more">+${dayLeaves.length - 3}</span>` : "";
    const isToday = dateStr === new Date().toISOString().slice(0, 10);
    html += `<div class="cal-cell ${isToday ? "today" : ""}">
      <span class="cal-day">${d}</span>${chips}${more}</div>`;
  }

  $("calGrid").innerHTML = html;
}

/* ===== الموافقات (للمدير) ===== */

async function renderApprovals() {
  const isManager = currentUser.role === "manager" || currentUser.role === "admin" || !useFirebase;
  const tbody = $("approvalsTable").querySelector("tbody");
  tbody.innerHTML = "";

  if (!isManager) {
    $("approvalsEmpty").textContent = "هذه الشاشة للمدير فقط";
    $("approvalsEmpty").style.display = "block";
    return;
  }

  const pending = (await getAllLeaves())
    .filter(l => l.status === "pending" &&
      (currentUser.role === "admin" || !useFirebase || l.team === currentUser.team));

  $("approvalsEmpty").style.display = pending.length ? "none" : "block";
  $("approvalsEmpty").textContent = "لا توجد طلبات معلقة";

  pending.forEach(l => {
    const t = LEAVE_TYPES[l.leave_type] || { label: l.leave_type };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(l.employee_name)}<br><span class="subtitle">${esc(l.team || "")}</span></td>
      <td>${t.label}</td>
      <td>${fmt(l.start_date)}</td>
      <td>${fmt(l.end_date)}</td>
      <td>${l.total_days}</td>
      <td class="comments">${esc(l.comments || "-")}</td>
      <td class="actions">
        ${l.attachment_url ? `<a class="btn ghost small" href="${l.attachment_url}" target="_blank" rel="noopener">المرفق</a> ` : ""}<button class="btn primary small" data-approve="${l.id}">موافقة</button>
        <button class="btn danger small" data-reject="${l.id}">رفض</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-approve]").forEach(b =>
    b.addEventListener("click", () => decide(b.dataset.approve, "approved")));
  tbody.querySelectorAll("[data-reject]").forEach(b =>
    b.addEventListener("click", () => decide(b.dataset.reject, "rejected")));
}

async function decide(id, status) {
  await updateLeave(id, { status, decided_by: currentUser.name });
  renderApprovals();
  loadMyLeaves();
}
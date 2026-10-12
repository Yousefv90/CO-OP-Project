/* =====================================================
   نظام إجازات الفريق - واجهات التطبيق
   (حجز إجازة، طلباتي، الرصيد، التقويم، الموافقات)
   ===================================================== */
/* eslint-disable no-undef */

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

/* ===== المرفقات (base64 داخل Firestore - بديل مجاني عن Storage) ===== */

const MAX_ATTACHMENT = 700 * 1024; // ~700KB بعد التحويل (حد المستند في Firestore هو 1MB)

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ضغط الصورة قبل الحفظ حتى تصغر وتدخل في Firestore
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxSide = 1200;
      let w = img.width, h = img.height;
      if (w > maxSide || h > maxSide) {
        const k = maxSide / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function prepareAttachment(file) {
  let dataUrl;
  if (file.type.startsWith("image/")) {
    dataUrl = await compressImage(file);
  } else {
    if (file.size > MAX_ATTACHMENT) throw new Error("big");
    dataUrl = await readAsDataURL(file);
  }
  if (dataUrl.length > MAX_ATTACHMENT) throw new Error("big");
  return { data: dataUrl, name: file.name };
}

// فتح المرفق من السجل
function openAttachment(dataUrl) {
  try {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "application/octet-stream";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), "_blank");
  } catch (e) {
    window.open(dataUrl, "_blank");
  }
}

/* ===== التنقل بين الأقسام ===== */

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["home", "balance", "calendar", "approvals", "admin"].forEach(s =>
      document.getElementById("sec-" + s).style.display = s === btn.dataset.sec ? "block" : "none");
    if (btn.dataset.sec === "calendar") renderCalendar();
    if (btn.dataset.sec === "approvals") renderApprovals();
    if (btn.dataset.sec === "admin") renderAdmin();
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

  // قراءة وضغط المرفق (إن وجد)
  let attachment = null;
  const fileInput = $("lvAttachment");
  if (fileInput.files && fileInput.files[0]) {
    try {
      attachment = await prepareAttachment(fileInput.files[0]);
    } catch (err) {
      $("leaveError").textContent = "تعذر إضافة المرفق (جرب صورة أصغر حجماً)";
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
    attachment_data: attachment ? attachment.data : "",
    attachment_name: attachment ? attachment.name : "",
    status: "pending",
    decided_by: ""
  });

  $("leaveForm").reset();
  fileInput.value = "";
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
      <td><span class="dot" style="background:${t.color}"></span>${t.label}${l.attachment_data ? " 📎" : ""}</td>
      <td>${fmt(l.start_date)}</td>
      <td>${fmt(l.end_date)}</td>
      <td>${l.total_days}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>${l.status === "pending" ? `<button class="btn ghost small" data-cancel="${l.id}">إلغاء</button>` : ""}</td>`;
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

  const usedIn = (type) => myLeaves
    .filter(l => l.leave_type === type && l.status === "approved" && l.start_date.startsWith(year))
    .reduce((s, l) => s + Number(l.total_days || 0), 0);

  const usedAnnual = usedIn("annual");
  const usedSick = usedIn("sick");

  // شرائح المرضية: أول 30 يوم براتب كامل، 60 يوم بـ75%، 30 يوم بدون راتب
  const sick1 = Math.min(usedSick, 30);
  const sick2 = Math.min(Math.max(usedSick - 30, 0), 60);
  const sick3 = Math.max(usedSick - 90, 0);

  [
    ["الإجازات السنوية", usedAnnual, 30],
    ["المرضية - براتب كامل", sick1, 30],
    ["المرضية - 75% من الراتب", sick2, 60],
    ["المرضية - بدون راتب", sick3, 30]
  ].forEach(([title, used, total]) => {
    const remain = Math.max(0, total - used);
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

  // تاريخ اليوم بالتوقيت المحلي (وليس UTC)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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
    const isToday = dateStr === todayStr;
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
        ${l.attachment_data ? `<button class="btn ghost small" data-view="${l.id}">📎 مرفق</button>` : ""}
        <button class="btn primary small" data-approve="${l.id}">موافقة</button>
        <button class="btn danger small" data-reject="${l.id}">رفض</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-approve]").forEach(b =>
    b.addEventListener("click", () => decide(b.dataset.approve, "approved")));
  tbody.querySelectorAll("[data-reject]").forEach(b =>
    b.addEventListener("click", () => decide(b.dataset.reject, "rejected")));

  tbody.querySelectorAll("[data-view]").forEach(b =>
    b.addEventListener("click", async () => {
      const leaves = await getAllLeaves();
      const lv = leaves.find(x => String(x.id) === String(b.dataset.view));
      if (lv && lv.attachment_data) openAttachment(lv.attachment_data);
    }));
}

async function decide(id, status) {
  await updateLeave(id, { status, decided_by: currentUser.name });
  renderApprovals();
  loadMyLeaves();
}

/* ===== الإدارة (للأدمن) ===== */

async function renderAdmin() {
  const tbody = $("adminUsersTable").querySelector("tbody");
  tbody.innerHTML = "";
  const users = await getAllUsers();

  users.forEach(u => {
    const key = String(u.id || u.email);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(u.name)}</td>
      <td class="subtitle">${esc(u.email || "-")}</td>
      <td>${esc(u.team || "-")}</td>
      <td>
        <select data-role-for="${key}">
          <option value="member" ${u.role === "member" ? "selected" : ""}>موظف</option>
          <option value="manager" ${u.role === "manager" ? "selected" : ""}>مدير</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>أدمن</option>
        </select>
      </td>
      <td><button class="btn primary small" data-save-role="${key}">حفظ</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-save-role]").forEach(b =>
    b.addEventListener("click", async () => {
      const sel = tbody.querySelector(`[data-role-for="${b.dataset.saveRole}"]`);
      const allUsers = await getAllUsers();
      const u = allUsers.find(x => String(x.id || x.email) === b.dataset.saveRole);
      if (u) {
        await updateUserRole(u, sel.value);
        await renderAdmin();
        alert("تم تحديث الصلاحية");
      }
    }));
}
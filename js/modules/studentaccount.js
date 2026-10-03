// Public self-service student account creation. The server validates the
// learner against school or approved online-class records before making Auth
// credentials, so no privileged browser key is exposed.
import { getState } from "../core/adapter.js";
import { el, modal, toast } from "../core/utils.js";
import { btn, field, input, select } from "../core/ui.js";

function messageFrom(error) {
  return error?.message || "Account creation could not be completed.";
}

export function openStudentAccountCreation() {
  const accountType = select([
    { value:"school", label:"School student" },
    { value:"online", label:"Approved online-class learner" }
  ]);
  const identifier = input({ placeholder:"Student ID or admission number", autocomplete:"off" });
  const registeredPhone = input({ type:"tel", placeholder:"Registered parent / guardian phone", autocomplete:"tel" });
  const email = input({ type:"email", placeholder:"name@example.com", autocomplete:"email" });
  const password = input({ type:"password", placeholder:"At least 8 characters", autocomplete:"new-password" });
  const confirmPassword = input({ type:"password", placeholder:"Repeat your password", autocomplete:"new-password" });
  const hint = el("p", { class:"muted", style:"grid-column:1/-1;margin:0;font-size:12px" });

  const updateMode = () => {
    const online = accountType.value === "online";
    identifier.placeholder = online ? "Online registration reference (e.g. OCL-...)" : "Student ID or admission number";
    registeredPhone.closest(".field")?.classList.toggle("hidden", online);
    hint.textContent = online
      ? "Use the email from your approved online-class registration and the reference shown when you registered."
      : "Use your school Student ID or admission number and the parent/guardian phone saved by the school.";
  };
  accountType.onchange = updateMode;

  const body = el("div", { class:"form-grid" }, [
    field("Account type", accountType, { full:true }),
    field("Student / registration reference", identifier, { full:true }),
    field("Registered phone", registeredPhone, { full:true }),
    field("Email for this account", email, { full:true }),
    field("Create password", password), field("Confirm password", confirmPassword), hint
  ]);
  updateMode();

  const dialog = modal({ title:"Create Student Account", size:"lg", body, footer:[
    btn("Create account", { variant:"primary", onclick: async() => {
      const mode = accountType.value;
      if (!identifier.value.trim() || !email.value.trim() || !password.value) return toast("Complete all required account details.", "error");
      if (mode === "school" && !registeredPhone.value.trim()) return toast("Enter the registered parent or guardian phone number.", "error");
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return toast("Enter a valid email address.", "error");
      if (password.value.length < 8) return toast("Use a password with at least 8 characters.", "error");
      if (password.value !== confirmPassword.value) return toast("The passwords do not match.", "error");
      const submit = dialog.dialog.querySelector("button.btn-primary");
      if (submit) { submit.disabled = true; submit.textContent = "Creating…"; }
      try {
        const client = getState().client;
        if (!client) throw new Error("The account service is still loading. Please try again in a moment.");
        const { data, error } = await client.functions.invoke("create-student-account", { body:{
          mode, identifier:identifier.value, registeredPhone:registeredPhone.value, email:email.value, password:password.value
        }});
        if (error) {
          let detail = error.message;
          if (typeof error.context?.json === "function") { try { detail = (await error.context.json())?.error || detail; } catch {} }
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);
        dialog.close();
        const complete = modal({ title:"Account created", body:el("div", {}, [
          el("p", { text:"Your Student Portal account is ready." }),
          el("p", { class:"muted", text:"Return to Student Login and sign in with your email and the password you just created." })
        ]), footer:[btn("Go to Student Login", { variant:"primary", onclick:()=>complete.close() })] });
      } catch (error) {
        toast(messageFrom(error), "error", 7000);
        if (submit) { submit.disabled = false; submit.textContent = "Create account"; }
      }
    }}), btn("Cancel", { onclick:()=>dialog.close() })
  ]});
}

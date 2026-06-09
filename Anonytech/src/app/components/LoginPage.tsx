import React, { useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Lock, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notification, NotificationType } from "./Notification";

const API: string =
  (import.meta as ImportMeta & {
    env: { VITE_API_URL?: string };
  }).env.VITE_API_URL || "http://localhost:5000";

export function LoginPage() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistration, setIsRegistration] = useState(false);
  const [voterId, setVoterId] = useState<string | null>(null);

  const { t, i18n } = useTranslation();
  const language = i18n.language === "sw" ? "KS" : "EN";
  const setLanguage = (lang: string) =>
    i18n.changeLanguage(lang === "KS" ? "sw" : "en");

  const [notification, setNotification] = useState<{
    type: NotificationType;
    message: string;
  } | null>(null);

  const navigate = useNavigate();

  const notify = (type: NotificationType, message: string) =>
    setNotification({ type, message });

  // Step 1: Authenticate or Register
  const handleVerifyEligibility = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isRegistration) {
        if (!name || !studentId || !email || !password) {
          notify("error", t("All fields are required."));
          return;
        }
        if (password !== confirmPassword) {
          notify("error", t("Passwords do not match."));
          return;
        }
        if (password.length < 6) {
          notify("error", t("Password must be at least 6 characters."));
          return;
        }

        const res = await fetch(`${API}/api/voters/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId,
            email,
            fullName: name,
            password,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          notify("error", data.error ?? t("Registration failed."));
          return;
        }

        // Store voter info
        sessionStorage.setItem("voter", JSON.stringify(data));
        sessionStorage.setItem("voterId", data.student_id || data.id);
        setVoterId(data.student_id || data.id);

        notify("success", t("Registered! Please check your email for OTP."));

        await fetch(`${API}/api/otp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, voterId: data.student_id || data.id }),
        });

        setStep(2);
      } else {
        // Login
        if (!email || !password) {
          notify("error", t("Email and password are required."));
          return;
        }

        const res = await fetch(`${API}/api/voters/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          notify("error", data.error ?? t("Login failed."));
          return;
        }

        sessionStorage.setItem("voter", JSON.stringify(data));
        sessionStorage.setItem("voterId", data.student_id || data.id);
        setVoterId(data.student_id || data.id);

        if (data.role === "admin") {
          // ✅ KEY FIX: store adminEmail in localStorage so AdminDashboard
          // and AdminRegistry can read it via getAdminEmail() / localStorage.getItem("adminEmail")
          localStorage.setItem("adminEmail", data.email);
          navigate("/admin");
        } else {
          // Send OTP for blind signature process
          await fetch(`${API}/api/otp/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, voterId: data.student_id || data.id }),
          });
          setStep(2);
        }
      }
    } catch {
      notify("error", t("Network error. Is the server running?"));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP and perform blind signature
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = otp.join("");
    if (otpCode.length < 6) return;

    setIsLoading(true);

    try {
      const voterIdFromStorage = sessionStorage.getItem("voterId");

      const res = await fetch(`${API}/api/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otp: otpCode,
          email,
          voterId: voterIdFromStorage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        notify("error", data.error ?? t("Invalid OTP code."));
        setIsLoading(false);
        return;
      }

      // Store the blind signature credentials
      if (data.blind_token)     sessionStorage.setItem("blindToken",    data.blind_token);
      if (data.blind_signature) sessionStorage.setItem("blindSignature", data.blind_signature);
      if (data.rsa_public_key)  sessionStorage.setItem("rsaPublicKey",  JSON.stringify(data.rsa_public_key));

      notify("success", t("Identity verified! You can now vote."));
      navigate("/welcome");
    } catch (error) {
      notify("error", t("Failed to verify OTP. Please try again."));
      console.error("OTP verification error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value[0];
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 bg-[#F8FAFC] relative z-10 font-['Inter',sans-serif]">
      {/* Header */}
      <div className="absolute top-0 left-0 w-full px-8 py-5 flex justify-between items-center z-50">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#0D5D56]" />
          <span className="font-['Figtree'] font-bold text-xl text-[#0D5D56]">
            {t("AnonyTech")}
          </span>
        </div>
        <div className="flex items-center bg-white border border-[#A7F3D0] rounded-full p-1 shadow-sm">
          {(["EN", "KS"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                language === lang
                  ? "bg-[#0D5D56] text-[#A7F3D0]"
                  : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <AnimatePresence mode="wait">
        {/* Step 1: Login / Register */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md rounded-[40px] bg-white p-10 shadow-[0_16px_40px_rgba(13,93,86,0.1)] border border-[#A7F3D0] relative overflow-hidden"
          >
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-[#A7F3D0]/30 rounded-full blur-[60px] pointer-events-none" />

            <div className="mb-8 text-center relative z-10">
              <h1 className="font-['Figtree'] text-3xl font-bold tracking-tight text-[#0D5D56] mb-2">
                {isRegistration ? t("Voter Sign-up") : t("Secure Login")}
              </h1>
              <p className="text-sm font-bold text-[#0D5D56]/70">
                {isRegistration
                  ? t("Register your identity to receive a token.")
                  : t("Enter your credentials to access the ballot.")}
              </p>
            </div>

            <form onSubmit={handleVerifyEligibility} className="space-y-5 relative z-10">
              {isRegistration && (
                <>
                  <Field label={t("Full Name")}>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("Jane Doe")}
                      required
                    />
                  </Field>
                  <Field label={t("Student ID")}>
                    <Input
                      type="text"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="SCT221-0001/2023"
                      required
                    />
                  </Field>
                </>
              )}

              <Field label={t("University Email")}>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@school.edu"
                  required
                />
              </Field>

              <Field label={t("Password")}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </Field>

              {isRegistration && (
                <Field label={t("Confirm Password")}>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </Field>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={isLoading}
                className="w-full rounded-[24px] bg-[#0D5D56] px-5 py-4 text-base font-bold text-[#A7F3D0] transition-all shadow-[0_8px_20px_rgba(13,93,86,0.2)] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading
                  ? t("Please wait…")
                  : isRegistration
                  ? t("Register Identity")
                  : t("Authenticate")}
              </motion.button>

              <p className="text-center text-sm text-[#0D5D56]/60 font-bold pt-1">
                {isRegistration ? t("Already registered?") : t("New voter?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistration(!isRegistration);
                    setNotification(null);
                  }}
                  className="text-[#0D5D56] underline underline-offset-2"
                >
                  {isRegistration ? t("Sign in") : t("Register here")}
                </button>
              </p>
            </form>
          </motion.div>
        )}

        {/* Step 2: OTP verification with blind signature */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md rounded-[40px] bg-white p-10 shadow-[0_16px_40px_rgba(13,93,86,0.1)] border border-[#A7F3D0]"
          >
            <div className="mb-10 text-center">
              <h1 className="font-['Figtree'] text-3xl font-bold tracking-tight text-[#0D5D56] mb-3">
                {t("Secure OTP")}
              </h1>
              <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                {t("Enter the 6-digit code sent to your official mail.")}
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-8">
              <div className="flex justify-between gap-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`otp-${idx}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    className="w-12 h-14 rounded-[16px] border-2 border-[#A7F3D0] bg-[#F8FAFC] text-center text-xl font-bold text-[#0D5D56] focus:bg-white focus:outline-none focus:border-[#0D5D56] transition-all shadow-inner"
                  />
                ))}
              </div>

              <div className="flex flex-col items-center justify-center py-2 h-16 text-[#0D5D56]">
                {isLoading ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center"
                  >
                    <Lock className="w-6 h-6 mb-2 animate-pulse text-[#A7F3D0]" />
                    <p className="text-xs font-bold">
                      {t("Generating Blind Signature…")}
                    </p>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center opacity-50">
                    <Lock className="w-5 h-5 mb-1" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">
                      {t("Awaiting OTP")}
                    </p>
                  </div>
                )}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={otp.join("").length < 6 || isLoading}
                className="w-full rounded-[24px] bg-[#0D5D56] px-5 py-4 text-base font-bold text-[#A7F3D0] transition-all shadow-[0_8px_20px_rgba(13,93,86,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("Verify & Get Voting Token")}
              </motion.button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-[#0D5D56] ml-2 block uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-[24px] border border-[#A7F3D0] bg-[#F8FAFC] px-5 py-4 text-[#0D5D56] placeholder-[#0D5D56]/40 shadow-sm focus:bg-white focus:outline-none focus:border-[#0D5D56] font-bold transition-all ${className}`}
    />
  );
}
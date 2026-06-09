import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type NotificationType = "success" | "error" | "info";

interface NotificationProps {
  type: NotificationType;
  message: string;
  onClose: () => void;
  duration?: number;
}

export function Notification({ type, message, onClose, duration = 4000 }: NotificationProps) {
  const { t } = useTranslation();
  
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => onClose(), duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const config = {
    success: { color: "#0D5D56", icon: CheckCircle2, bg: "#E6F4F1", border: "#0D5D56" },
    error: { color: "#B22222", icon: AlertCircle, bg: "#FDF0F0", border: "#B22222" },
    info: { color: "#1B4F72", icon: Info, bg: "#EBF5FB", border: "#1B4F72" }
  };

  const { color, icon: Icon, bg, border } = config[type];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className="fixed top-6 left-6 z-[200] flex items-center justify-between w-full max-w-sm p-4 rounded-xl shadow-lg border-l-4"
      style={{ backgroundColor: bg, borderLeftColor: border }}
    >
      <div className="flex items-center gap-3">
        <Icon size={24} style={{ color }} />
        <p className="font-bold text-sm" style={{ color }}>{message}</p>
      </div>
      <button 
        onClick={onClose}
        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors opacity-80 hover:opacity-100"
        style={{ color, backgroundColor: `${color}15` }}
      >
        {t("Dismiss")}
      </button>
    </motion.div>
  );
}
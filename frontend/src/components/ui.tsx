"use client";
import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useId,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Sparkles, X, ArrowUpRight } from "lucide-react";
import Link from "next/link";
export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(values));
const buttonVariants = cva("button", {
  variants: {
    variant: {
      primary: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
  },
  defaultVariants: { variant: "primary" },
});
export function Button({
  variant = "primary",
  asChild = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}
export function Input({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} />
    </div>
  );
}
export function Textarea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea rows={3} {...props} id={id} />
    </div>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select {...props} id={id}>
        {children}
      </select>
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "pink" | "green";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Logo() {
  return (
    <Link href="/" className="logo">
      <span className="logo-mark">
        <Sparkles size={20} fill="currentColor" />
      </span>
      Social<span className="logo-ai">AI</span>
      <span className="logo-period">.</span>
    </Link>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  contentClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={cn("modal", contentClassName)}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            {description || "Manage your local demo workspace."}
          </Dialog.Description>
          <Dialog.Close className="modal-close" aria-label="Close dialog">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Sparkles size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function RouteButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Button asChild>
      <Link href={href}>
        {children}
        <ArrowUpRight size={16} />
      </Link>
    </Button>
  );
}

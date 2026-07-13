"use client"

import type { ReactNode } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ErrorToastViewport,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

function ToastContent({
  title,
  description,
  action,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <>
      <div className="grid gap-1">
        {title && <ToastTitle>{title}</ToastTitle>}
        {description && <ToastDescription>{description}</ToastDescription>}
      </div>
      {action}
      <ToastClose />
    </>
  )
}

export function Toaster() {
  const { toasts } = useToast()
  const errorToasts = toasts.filter((t) => t.variant === "destructive")
  const infoToasts = toasts.filter((t) => t.variant !== "destructive")

  return (
    <>
      <ToastProvider>
        {infoToasts.map(({ id, title, description, action, ...props }) => (
          <Toast key={id} {...props}>
            <ToastContent
              title={title}
              description={description}
              action={action}
            />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>

      {errorToasts.length > 0 && (
        <div
          className="fixed inset-0 z-[99] bg-black/30"
          aria-hidden="true"
        />
      )}

      <ToastProvider duration={8000}>
        {errorToasts.map(({ id, title, description, action, ...props }) => (
          <Toast key={id} {...props} className="w-full max-w-md">
            <ToastContent
              title={title}
              description={description}
              action={action}
            />
          </Toast>
        ))}
        <ErrorToastViewport />
      </ToastProvider>
    </>
  )
}

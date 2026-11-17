import { z } from "zod";
export function createAuthSchema(mode: "login" | "signup" | "forgot-password") {
  return z
    .object({
      name: z.string(),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.email("Enter a valid email address.")),
      password: z.string().max(128, "Use no more than 128 characters."),
      confirm: z.string(),
      terms: z.boolean(),
    })
    .superRefine((value, ctx) => {
      if (mode !== "forgot-password" && !value.password)
        ctx.addIssue({
          code: "custom",
          path: ["password"],
          message: "Enter your password.",
        });
      if (mode === "signup") {
        if (value.name.trim().length < 2 || value.name.trim().length > 150)
          ctx.addIssue({
            code: "custom",
            path: ["name"],
            message: "Use a full name between 2 and 150 characters.",
          });
        if (
          value.password.length < 12 ||
          !/[a-zA-Z]/.test(value.password) ||
          !/[0-9]/.test(value.password)
        )
          ctx.addIssue({
            code: "custom",
            path: ["password"],
            message: "Use 12–128 characters, including a letter and a number.",
          });
        if (!value.confirm)
          ctx.addIssue({
            code: "custom",
            path: ["confirm"],
            message: "Confirm your password.",
          });
        if (!value.terms)
          ctx.addIssue({
            code: "custom",
            path: ["terms"],
            message: "Please acknowledge the terms and privacy notice.",
          });
      }
      if (
        mode === "signup" &&
        value.confirm &&
        value.password !== value.confirm
      )
        ctx.addIssue({
          code: "custom",
          path: ["confirm"],
          message: "Passwords do not match.",
        });
    });
}
export const authSchema = createAuthSchema("signup");
export const websiteSchema = z
  .url("Enter a full URL, such as https://yourbrand.com.")
  .refine((url) => /^https?:\/\//i.test(url), "Use an http or https URL.");
export function validBrand(name: string, description: string) {
  return name.trim().length >= 2 && description.trim().length >= 10;
}

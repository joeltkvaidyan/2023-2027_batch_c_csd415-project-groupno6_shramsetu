import fs from "node:fs";
import { config } from "../config.js";

/**
 * SMS delivery adapter.
 *
 * The default adapter prints the OTP to the backend terminal (dev/demo mode
 * preserved verbatim). In production, deployers replace `provider` with a real
 * SMS gateway (Twilio, MSG91, AWS SNS, etc.) by setting SMS_PROVIDER and
 * implementing the `send` function below.
 *
 * Interface: send(mobile: string, code: string) => Promise<void>
 */

const provider = (process.env.SMS_PROVIDER || "terminal").toLowerCase();

async function sendTerminal(mobile, code) {
  const line = "─".repeat(52);
  console.log(`\n${line}`);
  console.log(`  📩 OTP for +91 ${mobile}:  ${code}`);
  console.log(`  (valid ${Math.round(config.otp.expireSeconds / 60)} min — ShramSetu dev terminal delivery)`);
  console.log(`${line}\n`);
  try {
    if (config.otp.echoEnabled) {
      fs.mkdirSync("logs", { recursive: true });
      fs.appendFileSync(
        "logs/otp-dev.log",
        `${new Date().toISOString()} +91 ${mobile} OTP ${code}\n`
      );
    }
  } catch {
    /* best-effort; never block the login flow over a log write */
  }
}

async function sendSmsGateway(mobile, code) {
  /* eslint-disable no-console */
  console.warn(`[smsAdapter] SMS_PROVIDER=${provider} is not implemented. ` +
    `Falling back to terminal delivery for +91 ${mobile}. ` +
    `Implement send(mobile, code) in server/src/services/smsAdapter.js for your gateway.`);
  /* eslint-enable no-console */
  return sendTerminal(mobile, code);
}

const send = provider === "terminal" ? sendTerminal : sendSmsGateway;

export { send };

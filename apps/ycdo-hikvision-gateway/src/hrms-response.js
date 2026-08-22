"use strict";

function parseHrmsResponse(text) {
  if (!text) return { accepted: undefined, idempotent: false, reason: null };
  try {
    const j = JSON.parse(text);
    const reason =
      typeof j.reason === "string"
        ? j.reason
        : typeof j.message === "string"
          ? j.message
          : null;
    return {
      accepted: j.accepted,
      idempotent: Boolean(j.idempotent),
      reason,
    };
  } catch {
    return { accepted: undefined, idempotent: false, reason: null };
  }
}

function deliveryOutcome(httpStatus, responseText) {
  const parsed = parseHrmsResponse(responseText);

  if (httpStatus >= 200 && httpStatus < 300) {
    if (parsed.accepted === true) {
      return {
        deliveryStatus: "DELIVERED",
        hrmsReason: parsed.reason || "ACCEPTED",
      };
    }
    if (parsed.accepted === false && parsed.idempotent) {
      return {
        deliveryStatus: "DELIVERED",
        hrmsReason: parsed.reason || "DEVICE_EVENT_ALREADY_PROCESSED",
      };
    }
    if (parsed.accepted === false) {
      return {
        deliveryStatus: "REJECTED_BY_HRMS",
        hrmsReason: parsed.reason || "HRMS_REJECTED",
      };
    }
    return { deliveryStatus: "DELIVERED", hrmsReason: parsed.reason || null };
  }

  if (httpStatus >= 400 && httpStatus < 500 && ![408, 429].includes(httpStatus)) {
    return {
      deliveryStatus: "REJECTED_BY_HRMS",
      hrmsReason: parsed.reason || `HTTP_${httpStatus}`,
    };
  }

  return {
    deliveryStatus: "RETRY",
    hrmsReason: parsed.reason || `HTTP_${httpStatus}`,
  };
}

module.exports = { parseHrmsResponse, deliveryOutcome };

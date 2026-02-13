import { Kafka } from "kafkajs";
import { getPool } from "../db";
import { insertProcessedEvent } from "../events";
import { validateEvent, ValidationError } from "../validation";

const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const topicOrders = process.env.TOPIC_ORDERS ?? "orders.v1";
const topicPayments = process.env.TOPIC_PAYMENTS ?? "payments.v1";
const topicDisputes = process.env.TOPIC_DISPUTES ?? "disputes.v1";
const groupId = process.env.KAFKA_GROUP_ID ?? "risk-engine";

const kafka = new Kafka({ clientId: "risk-engine", brokers });
const consumer = kafka.consumer({ groupId });

const topics = [topicOrders, topicPayments, topicDisputes];

export async function startConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString("utf8");
      if (!raw) {
        console.warn("[kafka] empty value", { topic, partition: message.partition, offset: message.offset });
        return;
      }

      try {
        const event = validateEvent(topic, raw);
        const inserted = await insertProcessedEvent(getPool(), {
          eventId: event.id,
          correlationId: event.correlationId,
          topic,
          payload: raw,
        });
        console.log("[kafka] ok", {
          topic,
          eventId: event.id,
          correlationId: event.correlationId,
          stored: inserted ? "new" : "duplicate",
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          console.warn("[kafka] invalid", { topic, reason: err.message.slice(0, 100) });
          return;
        }
        throw err;
      }
    },
  });

  console.log("[kafka] consumer running", { topics, groupId });
}

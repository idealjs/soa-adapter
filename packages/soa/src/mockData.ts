import { z } from "zod";

export const mockRecordSchema = z.object({
	id: z.string(),
	tenantId: z.string(),
	active: z.boolean(),
	profile: z.object({
		name: z.string(),
		age: z.number(),
		score: z.number(),
		level: z.enum(["bronze", "silver", "gold", "platinum"]),
		preferences: z.object({
			email: z.boolean(),
			push: z.boolean(),
			tags: z.array(z.string()),
		}),
		addresses: z.array(
			z.object({
				city: z.string(),
				country: z.string(),
				zip: z.string(),
				coordinates: z.object({
					lat: z.number(),
					lng: z.number(),
				}),
			}),
		),
	}),
	orders: z.array(
		z.object({
			orderId: z.string(),
			status: z.enum(["pending", "paid", "shipped", "completed"]),
			total: z.number(),
			items: z.array(
				z.object({
					sku: z.string(),
					quantity: z.number(),
					price: z.number(),
					attributes: z.object({
						color: z.string(),
						size: z.string(),
						fragile: z.boolean(),
					}),
				}),
			),
			payments: z.array(
				z.object({
					method: z.enum(["card", "wallet", "bank"]),
					amount: z.number(),
					settled: z.boolean(),
				}),
			),
			shipment: z.object({
				warehouse: z.string(),
				etaDays: z.number(),
				history: z.array(
					z.object({
						checkpoint: z.string(),
						at: z.number(),
					}),
				),
			}),
		}),
	),
	analytics: z.object({
		lastLogin: z.number(),
		retention: z.array(z.number()),
		funnels: z.array(
			z.object({
				step: z.string(),
				converted: z.boolean(),
				metadata: z.object({
					source: z.string(),
					campaign: z.string(),
				}),
			}),
		),
	}),
});

export type MockRecord = z.infer<typeof mockRecordSchema>;

export type MockDataOptions = {
	size?: number;
	seed?: number;
	maxAddresses?: number;
	maxOrders?: number;
	maxItemsPerOrder?: number;
	maxPaymentsPerOrder?: number;
	maxShipmentEvents?: number;
};

type RandomSource = () => number;

const LEVELS: MockRecord["profile"]["level"][] = [
	"bronze",
	"silver",
	"gold",
	"platinum",
];
const ORDER_STATUSES: MockRecord["orders"][number]["status"][] = [
	"pending",
	"paid",
	"shipped",
	"completed",
];
const PAYMENT_METHODS: MockRecord["orders"][number]["payments"][number]["method"][] = [
	"card",
	"wallet",
	"bank",
];
const SOURCES = ["organic", "ads", "referral", "partner"];
const CAMPAIGNS = ["spring", "summer", "autumn", "winter"];
const COLORS = ["red", "blue", "green", "black", "white"];
const SIZES = ["xs", "s", "m", "l", "xl"];
const CITIES = ["Shanghai", "Hangzhou", "Shenzhen", "Chengdu", "Wuhan"];
const COUNTRIES = ["CN", "SG", "JP", "DE", "US"];
const WAREHOUSES = ["wh-east", "wh-west", "wh-central"];
const TAGS = ["vip", "trial", "team", "north", "south", "enterprise"];

export function createComplexMockData(
	options: MockDataOptions = {},
): MockRecord[] {
	const {
		size = 1500,
		seed = 42,
		maxAddresses = 3,
		maxOrders = 5,
		maxItemsPerOrder = 4,
		maxPaymentsPerOrder = 2,
		maxShipmentEvents = 4,
	} = options;
	const random = createRandom(seed);

	return Array.from({ length: size }, (_, index) =>
		createMockRecord(index, random, {
			maxAddresses,
			maxOrders,
			maxItemsPerOrder,
			maxPaymentsPerOrder,
			maxShipmentEvents,
		}),
	);
}

export function createMockRecord(
	index: number,
	random = createRandom(index + 1),
	options: Required<Omit<MockDataOptions, "size" | "seed">> = {
		maxAddresses: 3,
		maxOrders: 5,
		maxItemsPerOrder: 4,
		maxPaymentsPerOrder: 2,
		maxShipmentEvents: 4,
	},
): MockRecord {
	const addressCount = randomCount(random, options.maxAddresses);
	const orderCount = randomCount(random, options.maxOrders);
	const retention = Array.from({ length: 4 }, (_, offset) =>
		round4(Math.max(0.1, 0.95 - offset * 0.18 - random() * 0.08)),
	);

	return {
		id: `user-${index}`,
		tenantId: `tenant-${index % 12}`,
		active: random() > 0.28,
		profile: {
			name: `User ${index}`,
			age: 18 + Math.floor(random() * 35),
			score: round2(300 + random() * 900),
			level: pick(random, LEVELS),
			preferences: {
				email: random() > 0.35,
				push: random() > 0.5,
				tags: createTags(random),
			},
			addresses: Array.from({ length: addressCount }, (_, addressIndex) => ({
				city: pick(random, CITIES),
				country: pick(random, COUNTRIES),
				zip: `${100000 + index * 17 + addressIndex}`,
				coordinates: {
					lat: round4(20 + random() * 30),
					lng: round4(90 + random() * 40),
				},
			})),
		},
		orders: Array.from({ length: orderCount }, (_, orderIndex) => {
			const itemCount = randomCount(random, options.maxItemsPerOrder);
			const items = Array.from({ length: itemCount }, (_, itemIndex) => {
				const quantity = 1 + Math.floor(random() * 4);
				const price = round2(25 + random() * 300);

				return {
					sku: `sku-${index}-${orderIndex}-${itemIndex}`,
					quantity,
					price,
					attributes: {
						color: pick(random, COLORS),
						size: pick(random, SIZES),
						fragile: random() > 0.74,
					},
				};
			});
			const total = round2(
				items.reduce((sum, item) => sum + item.quantity * item.price, 0),
			);
			const paymentCount = Math.min(
				randomCount(random, options.maxPaymentsPerOrder),
				2,
			);
			const shipmentEventCount = randomCount(random, options.maxShipmentEvents);

			return {
				orderId: `order-${index}-${orderIndex}`,
				status: pick(random, ORDER_STATUSES),
				total,
				items,
				payments: Array.from({ length: paymentCount }, (_, paymentIndex) => ({
					method: pick(random, PAYMENT_METHODS),
					amount:
						paymentIndex === paymentCount - 1
							? round2(
									total -
										totalPayments(paymentCount - 1, paymentIndex, total, random),
								)
							: round2(total / paymentCount),
					settled: random() > 0.15,
				})),
				shipment: {
					warehouse: pick(random, WAREHOUSES),
					etaDays: 1 + Math.floor(random() * 7),
					history: Array.from(
						{ length: shipmentEventCount },
						(_, eventIndex) => ({
							checkpoint: `checkpoint-${eventIndex}`,
							at: 1_700_000_000_000 + index * 10_000 + eventIndex * 3_600_000,
						}),
					),
				},
			};
		}),
		analytics: {
			lastLogin: 1_700_000_000_000 + index * 60_000,
			retention,
			funnels: ["visit", "signup", "checkout", "renew"].map((step, stepIndex) => ({
				step,
				converted: random() > 0.25 + stepIndex * 0.12,
				metadata: {
					source: pick(random, SOURCES),
					campaign: pick(random, CAMPAIGNS),
				},
			})),
		},
	};
}

export function cloneMockData(data: readonly MockRecord[]): MockRecord[] {
	return data.map(cloneMockRecord);
}

export function cloneMockRecord(record: MockRecord): MockRecord {
	return {
		id: record.id,
		tenantId: record.tenantId,
		active: record.active,
		profile: {
			name: record.profile.name,
			age: record.profile.age,
			score: record.profile.score,
			level: record.profile.level,
			preferences: {
				email: record.profile.preferences.email,
				push: record.profile.preferences.push,
				tags: [...record.profile.preferences.tags],
			},
			addresses: record.profile.addresses.map((address) => ({
				city: address.city,
				country: address.country,
				zip: address.zip,
				coordinates: {
					lat: address.coordinates.lat,
					lng: address.coordinates.lng,
				},
			})),
		},
		orders: record.orders.map((order) => ({
			orderId: order.orderId,
			status: order.status,
			total: order.total,
			items: order.items.map((item) => ({
				sku: item.sku,
				quantity: item.quantity,
				price: item.price,
				attributes: {
					color: item.attributes.color,
					size: item.attributes.size,
					fragile: item.attributes.fragile,
				},
			})),
			payments: order.payments.map((payment) => ({
				method: payment.method,
				amount: payment.amount,
				settled: payment.settled,
			})),
			shipment: {
				warehouse: order.shipment.warehouse,
				etaDays: order.shipment.etaDays,
				history: order.shipment.history.map((event) => ({
					checkpoint: event.checkpoint,
					at: event.at,
				})),
			},
		})),
		analytics: {
			lastLogin: record.analytics.lastLogin,
			retention: [...record.analytics.retention],
			funnels: record.analytics.funnels.map((funnel) => ({
				step: funnel.step,
				converted: funnel.converted,
				metadata: {
					source: funnel.metadata.source,
					campaign: funnel.metadata.campaign,
				},
			})),
		},
	};
}

function createRandom(seed: number): RandomSource {
	let state = seed >>> 0;

	return () => {
		state = (1664525 * state + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function createTags(random: RandomSource): string[] {
	const count = randomCount(random, 3);
	const values = new Set<string>();

	while (values.size < count) {
		values.add(pick(random, TAGS));
	}

	return [...values];
}

function randomCount(random: RandomSource, max: number): number {
	return 1 + Math.floor(random() * Math.max(1, max));
}

function pick<T>(random: RandomSource, values: readonly T[]): T {
	return values[Math.floor(random() * values.length)] as T;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function totalPayments(
	count: number,
	index: number,
	total: number,
	_random: RandomSource,
): number {
	if (count <= 0 || index <= 0) {
		return 0;
	}

	return round2((total / (count + 1)) * count);
}

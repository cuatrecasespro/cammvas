export function isHtmlElement(value: unknown): value is HTMLElement {
	return typeof value === "object"
		&& value !== null
		&& typeof Reflect.get(value, "closest") === "function"
		&& typeof Reflect.get(value, "offsetHeight") === "number";
}

export function isDomNode(value: unknown): value is Node {
	return typeof value === "object"
		&& value !== null
		&& typeof Reflect.get(value, "nodeType") === "number";
}

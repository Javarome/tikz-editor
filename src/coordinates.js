/**
 * TikZ Coordinate System - Handles coordinate parsing and transformations
 */

export class Point {
  constructor(x, y) {
    this.x = x
    this.y = y
  }

  add(other) {
    return new Point(this.x + other.x, this.y + other.y)
  }

  subtract(other) {
    return new Point(this.x - other.x, this.y - other.y)
  }

  scale(factor) {
    return new Point(this.x * factor, this.y * factor)
  }

  rotate(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return new Point(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos
    )
  }

  clone() {
    return new Point(this.x, this.y)
  }
}

export class CoordinateSystem {
  constructor() {
    this.namedCoordinates = new Map()
    this.nodes = new Map()
    this.currentPosition = new Point(0, 0)
  }

  reset() {
    this.currentPosition = new Point(0, 0)
  }

  setNamedCoordinate(name, point) {
    this.namedCoordinates.set(name, point)
  }

  registerNode(name, point, anchors) {
    this.nodes.set(name, { center: point, anchors })
  }

  /**
   * Parse a coordinate string and return a Point
   * Formats:
   *   - (x, y) - Cartesian
   *   - (angle:radius) - Polar
   *   - (name) - Named coordinate
   *   - (name.anchor) - Node anchor
   *   - +(x,y) or ++(x,y) handled by caller via prefix
   */
  parseCoordinate(coordString, isRelative = false, updatePosition = true) {
    const trimmed = coordString.trim()

    // Check for polar coordinates (angle:radius)
    const polarMatch = trimmed.match(/^(-?\d+\.?\d*)\s*:\s*(-?\d+\.?\d*)$/)
    if (polarMatch) {
      const angle = parseFloat(polarMatch[1])
      const radius = parseFloat(polarMatch[2])
      const x = radius * Math.cos((angle * Math.PI) / 180)
      const y = radius * Math.sin((angle * Math.PI) / 180)
      let point = new Point(x, y)

      if (isRelative) {
        point = this.currentPosition.add(point)
      }

      if (updatePosition) {
        this.currentPosition = point
      }

      return point
    }

    // Check for Cartesian coordinates (x, y)
    const cartesianMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)
    if (cartesianMatch) {
      let point = new Point(
        parseFloat(cartesianMatch[1]),
        parseFloat(cartesianMatch[2])
      )

      if (isRelative) {
        point = this.currentPosition.add(point)
      }

      if (updatePosition) {
        this.currentPosition = point
      }

      return point
    }

    // Check for node anchor (name.anchor)
    const anchorMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z]+)$/)
    if (anchorMatch) {
      const nodeName = anchorMatch[1]
      const anchorName = anchorMatch[2]
      const node = this.nodes.get(nodeName)

      if (node && node.anchors && node.anchors[anchorName]) {
        const point = node.anchors[anchorName]
        if (updatePosition) {
          this.currentPosition = point
        }
        return point
      } else if (node) {
        // Fallback to center
        if (updatePosition) {
          this.currentPosition = node.center
        }
        return node.center
      }
    }

    // Check for named coordinate (name)
    const namedMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)$/)
    if (namedMatch) {
      const name = namedMatch[1]

      // Check nodes first
      if (this.nodes.has(name)) {
        const point = this.nodes.get(name).center
        if (updatePosition) {
          this.currentPosition = point
        }
        return point
      }

      // Then named coordinates
      if (this.namedCoordinates.has(name)) {
        const point = this.namedCoordinates.get(name)
        if (updatePosition) {
          this.currentPosition = point
        }
        return point
      }
    }

    // Couldn't parse - return current position
    return this.currentPosition.clone()
  }

  /**
   * Apply transformations to a point
   */
  applyTransformations(point, transforms) {
    let result = point.clone()

    for (const transform of transforms) {
      switch (transform.type) {
        case "shift":
          result = result.add(new Point(transform.x || 0, transform.y || 0))
          break
        case "xshift":
          result = result.add(new Point(transform.value, 0))
          break
        case "yshift":
          result = result.add(new Point(0, transform.value))
          break
        case "rotate":
          result = result.rotate(transform.angle)
          break
        case "scale":
          result = result.scale(transform.factor)
          break
        case "xscale":
          result = new Point(result.x * transform.factor, result.y)
          break
        case "yscale":
          result = new Point(result.x, result.y * transform.factor)
          break
      }
    }

    return result
  }

  /**
   * Calculate node anchors based on shape and dimensions
   */
  calculateAnchors(center, shape, width, height) {
    const hw = width / 2
    const hh = height / 2

    const anchors = {
      center: center,
      north: new Point(center.x, center.y + hh),
      south: new Point(center.x, center.y - hh),
      east: new Point(center.x + hw, center.y),
      west: new Point(center.x - hw, center.y),
      "north east": new Point(center.x + hw, center.y + hh),
      "north west": new Point(center.x - hw, center.y + hh),
      "south east": new Point(center.x + hw, center.y - hh),
      "south west": new Point(center.x - hw, center.y - hh)
    }

    // For circles, adjust corner anchors
    if (shape === "circle") {
      const r = Math.max(hw, hh)
      const diag = r * Math.SQRT1_2
      anchors["north east"] = new Point(center.x + diag, center.y + diag)
      anchors["north west"] = new Point(center.x - diag, center.y + diag)
      anchors["south east"] = new Point(center.x + diag, center.y - diag)
      anchors["south west"] = new Point(center.x - diag, center.y - diag)
    }

    return anchors
  }
}

/**
 * Parse a coordinate token value, handling relative prefixes
 * Returns { point, isRelative, updatesPosition }
 */
export function parseCoordinateToken(value, coordSystem) {
  let isRelative = false
  let updatesPosition = true
  let coordString = value

  // Handle ++ prefix (relative, updates position)
  if (coordString.startsWith("++")) {
    coordString = coordString.slice(2)
    isRelative = true
    updatesPosition = true
  }
  // Handle + prefix (relative, doesn't update position)
  else if (coordString.startsWith("+")) {
    coordString = coordString.slice(1)
    isRelative = true
    updatesPosition = false
  }

  // Remove parentheses if present (shouldn't be, but just in case)
  coordString = coordString.replace(/^\(/, "").replace(/\)$/, "")

  const point = coordSystem.parseCoordinate(coordString, isRelative, updatesPosition)

  return { point, isRelative, updatesPosition }
}

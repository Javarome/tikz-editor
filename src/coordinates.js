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

  registerNode(name, point, anchors, shape = "rectangle", width = 1, height = 0.5) {
    this.nodes.set(name, { center: point, anchors, shape, width, height })
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

    // Check for node anchor (name.anchor), allowing compound anchors like "north west"
    const anchorMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z]+(?:\s+[a-zA-Z]+)?)$/)
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

  /**
   * Calculate the point where a line from a node's center toward a target point
   * intersects with the node's boundary.
   * @param {string} nodeName - The name of the node
   * @param {Point} targetPoint - The point the line is heading toward
   * @returns {Point} - The intersection point on the node boundary
   */
  getNodeBoundaryPoint(nodeName, targetPoint) {
    const node = this.nodes.get(nodeName)
    if (!node) {
      return targetPoint
    }

    const center = node.center
    const shape = node.shape || "rectangle"
    // Use actual dimensions, with small fallback for unspecified sizes
    const width = (node.width !== undefined && node.width !== null) ? node.width : 0.2
    const height = (node.height !== undefined && node.height !== null) ? node.height : 0.2

    // Direction vector from center to target
    const dx = targetPoint.x - center.x
    const dy = targetPoint.y - center.y

    // If target is at the center, return center
    if (dx === 0 && dy === 0) {
      return center.clone()
    }

    const hw = width / 2
    const hh = height / 2

    if (shape === "circle") {
      // For circle, use the larger dimension as radius
      const r = Math.max(hw, hh)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const scale = r / dist
      return new Point(center.x + dx * scale, center.y + dy * scale)
    } else if (shape === "ellipse") {
      // For ellipse, scale the direction vector
      const angle = Math.atan2(dy, dx)
      const x = hw * Math.cos(angle)
      const y = hh * Math.sin(angle)
      return new Point(center.x + x, center.y + y)
    } else {
      // Rectangle: find intersection with the rectangle boundary
      // Calculate intersection with each edge and find the closest one
      const dist = Math.sqrt(dx * dx + dy * dy)
      const nx = dx / dist  // normalized direction
      const ny = dy / dist

      let t = Infinity

      // Check intersection with right edge (x = hw)
      if (nx !== 0) {
        const tRight = hw / nx
        if (tRight > 0) {
          const yAtRight = ny * tRight
          if (Math.abs(yAtRight) <= hh) {
            t = Math.min(t, tRight)
          }
        }
        // Check intersection with left edge (x = -hw)
        const tLeft = -hw / nx
        if (tLeft > 0) {
          const yAtLeft = ny * tLeft
          if (Math.abs(yAtLeft) <= hh) {
            t = Math.min(t, tLeft)
          }
        }
      }

      // Check intersection with top edge (y = hh)
      if (ny !== 0) {
        const tTop = hh / ny
        if (tTop > 0) {
          const xAtTop = nx * tTop
          if (Math.abs(xAtTop) <= hw) {
            t = Math.min(t, tTop)
          }
        }
        // Check intersection with bottom edge (y = -hh)
        const tBottom = -hh / ny
        if (tBottom > 0) {
          const xAtBottom = nx * tBottom
          if (Math.abs(xAtBottom) <= hw) {
            t = Math.min(t, tBottom)
          }
        }
      }

      if (t !== Infinity) {
        return new Point(center.x + nx * t, center.y + ny * t)
      }

      return center.clone()
    }
  }
}

/**
 * Parse a coordinate token value, handling relative prefixes
 * Returns { point, isRelative, updatesPosition, nodeName, anchorNodeName, anchorName }
 * nodeName is set if the coordinate references a node (without explicit anchor)
 * anchorNodeName and anchorName are set for explicit anchor references (node.anchor)
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

  // Check if this is a plain node reference (no anchor, no coordinates)
  // This is needed for auto-anchoring at node boundaries
  let nodeName = null
  let anchorNodeName = null
  let anchorName = null
  const trimmed = coordString.trim()

  // Check for anchor reference (node.anchor)
  const anchorMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z]+(?:\s+[a-zA-Z]+)?)$/)
  if (anchorMatch && !isRelative && coordSystem.nodes.has(anchorMatch[1])) {
    anchorNodeName = anchorMatch[1]
    anchorName = anchorMatch[2]
  }

  // Check for plain node reference
  const isNodeRef = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)$/)
  if (isNodeRef && !isRelative && coordSystem.nodes.has(isNodeRef[1])) {
    nodeName = isNodeRef[1]
  }

  const point = coordSystem.parseCoordinate(coordString, isRelative, updatesPosition)

  return { point, isRelative, updatesPosition, nodeName, anchorNodeName, anchorName }
}

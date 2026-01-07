// The canvas and its context
let canvas, ctx;

// Elements of the canvas
let boxes = [];
let links = [];

// Global parameters
const boxWidth = 200;
const boxHeight = 75;
let textLineHeight = 16;

// Parameters
let cursorPosWorld = { x: 0, y: 0 }; // Cursor position in the world
let cursorPosCanvas = { x: 0, y: 0 }; // Cursor position in the canvas
let mousedownPos = { ...cursorPosWorld }; // Last cursor position on mouse down; usefull to check if click or drag

// Modes
const DEFAULT = "default";
const DRAGGING = "dragging";
const GLOBAL_DRAGGING = "global dragging";
const CREATE_LINK = "create link";
const PHYSICS = "physics";
let MODE = DEFAULT;
let beginPos = undefined;
let createLinkSubject = undefined;
let createLinkObject = undefined;

// Zoom + global dragging
let scale = 1;
let offsetX = 0;
let offsetY = 0;

// Physic constants
const boxesRepulsion = 100000;
const linksAttraction = 0.01;
const linksRestLength = 500;
const speedLimit = 0.1;
const velocityDamping = 0.1;

/////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// TOOLING FUNCTIONS /////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Transform a given string into its camel case version.
 *
 * @param {*} str The normal string to transform to camel case.
 * @returns The camel case version of the given string.
 */
function toCamelCase(str) {
    return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
}

/**
 * The mouse coordinates inside the canvas world space.
 * Usefull to get coordinates of mouse in the canvas world space,
 * i.e. affected by transformation/scaling
 * e.g. top left is not always (0,0)
 *
 * @param {*} evt The event triggered by the user.
 * @returns The coordinates in the canvas world
 */
function getMousePos(evt) {
    const inv = ctx.getTransform().invertSelf();
    const pt = new DOMPoint(evt.offsetX, evt.offsetY).matrixTransform(inv);

    return {
        x: pt.x,
        y: pt.y,
    };
}

/**
 * Mouse coordinates on the canvas element, top left is always (0, 0)
 *
 * @param {*} evt The event triggered by the user.
 * @returns The coordinates in the canvas HTML element.
 */
function getMousePosCanvas(evt) {
    // Cursor position in canvas coordinates
    const rect = canvas.getBoundingClientRect();

    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    return { x, y };
}

/**
 * Function that return the distance in pixel of two given elements
 *
 * @param {any} elt1 Object that has a "x" and "y" attribute (in pixel)
 * @param {any} elt2 Object that has a "x" and "y" attribute (in pixel)
 * @returns
 */
function getElementDist(elt1, elt2) {
    return Math.sqrt((elt1.x - elt2.x) * (elt1.x - elt2.x) + (elt1.y - elt2.y) * (elt1.y - elt2.y));
}

/**
 * Hash function to get an integer between a range from a given string
 *
 * @param {*} str The string to hash
 * @param {*} min The minimal value wanted
 * @param {*} max The maximal value wanted
 * @returns
 */
function hash(str, min, max) {
    // FNV-1a 32-bit hash
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    // Convert to unsigned 32-bit
    hash >>>= 0;

    // Map to range [min, max]
    return min + (hash % (max - min + 1));
}

///////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// UTILITIES FUNCTIONS /////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Reset selected elements.
 * If not specified otherwise, reset everything.
 *
 * @param {*} only undefined, "links" or "boxes". Options to reset only part of everything
 */
function resetSelection(only = undefined) {
    // Unselect boxes
    if (only == undefined || only == "boxes") {
        boxes.forEach((box) => (box.selected = false));
    }

    // Unselect links (and remove display label)
    if (only == undefined || only == "links") {
        links.forEach((link) => {
            link.label = "";
            link.selected = false;
        });
    }

    // Reset related to link creation
    if (MODE == CREATE_LINK) MODE = DEFAULT;
    createLinkSubject = undefined;
    createLinkObject = undefined;
}

/**
 * Find all boxes that contain the given point.
 *
 * @param {*} x X coordinate of the click
 * @param {*} y Y coordinate of the click
 * @returns
 */
function findClickedBoxes(x, y) {
    return boxes.filter((box) => {
        const minX = box.x - boxWidth / 2;
        const maxX = minX + boxWidth;
        const minY = box.y - boxHeight / 2;
        const maxY = minY + boxHeight;

        // If the click is inside the rectangle, keep it
        return minX <= x && x <= maxX && minY <= y && y <= maxY;
    });
}

/**
 * Find all links that contain the given point.
 *
 * @param {*} x X coordinate of the click
 * @param {*} y Y coordinate of the click
 * @returns
 */
function findClickedLinks(x, y) {
    return links.filter((link) => {
        // First we define some vectors
        // A is the subject, B the object
        const vecABX = link.object.x - link.subject.x;
        const vecABY = link.object.y - link.subject.y;
        // P is the click point
        const vecAPX = x - link.subject.x;
        const vecAPY = y - link.subject.y;

        // Second we project P on the AB segment
        // and get the scalar t ("projection amount") which is the scalar product AP.AB / ||AB||^2
        let t = (vecAPX * vecABX + vecAPY * vecABY) / (vecABX * vecABX + vecABY * vecABY);
        // This express the "projection amount" with the line, not the segment, so we need to compare with A and B
        t = Math.max(0, Math.min(1, t));

        let dist;
        // if t is negative ==> closest point is A
        if (t < 0) dist = Math.sqrt((link.subject.x - x) * (link.subject.x - x) + (link.subject.y - y) * (link.subject.y - y));
        // if t is above 1 ==> closest point is B
        else if (t > 1) dist = Math.sqrt((link.object.x - x) * (link.object.x - x) + (link.object.y - y) * (link.object.y - y));
        // if t is between 0 and 1, the projection hits the segment
        else {
            // be C the projection
            const cx = link.subject.x + t * vecABX;
            const cy = link.subject.y + t * vecABY;
            // Then the distance is from P to C
            dist = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
        }

        // If the click is less than threshold far from any point of the link, keep it
        return dist < 10;
    });
}

/**
 * Add a new box to the existing ones.
 * When happening, the new box will be the only one selected.
 */
function createBox() {
    const box = { x: cursorPosWorld.x, y: cursorPosWorld.y, vx: 0, vy: 0, id: "", name: "", label: "", selected: true, type: "box" };
    resetSelection();
    boxes.push(box);
}

/**
 * Delete a box and all linked links.
 *
 * @param {*} boxToDelete The box to delete.
 */
function deleteBox(boxToDelete) {
    // Remove the wanted box
    boxes = boxes.filter((box) => box !== boxToDelete);
    // And also remove all links connected to it as subject or object
    links.filter((link) => link.subject == boxToDelete || link.object == boxToDelete).forEach((link) => deleteLink(link));
}

/**
 * Add a new link to the existing ones.
 * When happening, the new link will be the only one selected.
 */
function createLink() {
    const link = {
        subject: createLinkSubject,
        object: createLinkObject,
        id: "",
        predicate: "",
        cardinality: "",
        order: "",
        label: "",
        selected: true,
        type: "link",
    };
    createLinkSubject = undefined;
    createLinkObject = undefined;
    MODE = DEFAULT;

    resetSelection();
    links.push(link);
}

/**
 *
 * @param {*} linkToDelete The link to delete.
 */
function deleteLink(linkToDelete) {
    links = links.filter((link) => link !== linkToDelete);
}

/**
 * From a given box, takes its label and extract information from it.
 * Information are: id and name (class name).
 *
 * @param {*} box The box from which extract information from label.
 */
function parseBoxFromLabel(box) {
    let lines = box.label.split("\n");
    if (lines.length >= 1) box.id = lines[0].trim();
    if (lines.length >= 2) box.name = lines[1].trim();
}

/**
 * From a given link, takes its label and extract information from it.
 * Information are: order, card, id, pred.
 * In order to be extracted, information need to have specific format: "order: 3 - card: 0..*" etc
 *
 * @param {*} link The link from which extract information from label.
 */
function parseLinkFromLabel(link) {
    const elements = link.label.split(" - ");
    for (const chunk of elements) {
        if (chunk.includes("order:")) {
            link.order = chunk.replace("order:", "").trim();
            // link.label = "";
        }
        if (chunk.includes("card:")) {
            link.cardinality = chunk.replace("card:", "").trim();
            // link.label = "";
        }
        if (chunk.includes("id:")) {
            link.id = chunk.replace("id:", "").trim();
            // link.label = "";
        }
        if (chunk.includes("pred:")) {
            link.predicate = chunk.replace("pred:", "").trim();
            // link.label = "";
        }
    }
}

/**
 * Find a position for the given box, by hashing its label
 *
 * @param {*} label The box label
 * @returns the position as { x, y } of the box
 */
function getNewPosition(label) {
    // Find current mins and maxes
    let minX = Math.min(...boxes.map((box) => box.x));
    let maxX = Math.max(...boxes.map((box) => box.x));
    let minY = Math.min(...boxes.map((box) => box.y));
    let maxY = Math.max(...boxes.map((box) => box.y));

    // Deals with edge case: no boxes, only one boxes
    if (Number.isNaN(minX) || minX == Infinity || minX == maxX) minX = 0;
    if (Number.isNaN(maxX) || maxX == -Infinity || minX == maxX) maxX = canvas.width;
    if (Number.isNaN(minY) || minY == Infinity || minY == maxY) minY = 0;
    if (Number.isNaN(maxY) || maxY == -Infinity || minY == maxY) maxY = canvas.height;

    // We want the new points not to be place at the limit, but a bit further
    const width = maxX - minX;
    const height = maxY - minY;
    const dist = 0.2;
    minX = minX - dist * width;
    maxX = maxX + dist * width;
    minY = minY - dist * height;
    maxY = maxY + dist * height;

    // Get the hash
    const hashed = hash(label, 0, width + height + width + height);

    // Find the position
    let x, y;
    if (hashed < width) {
        x = hashed;
        y = minY;
    } else if (width <= hashed && hashed < width + height) {
        x = maxX;
        y = hashed - width;
    } else if (width + height <= hashed && hashed < width + height + width) {
        x = hashed - width - height;
        y = maxY;
    } else {
        x = minX;
        y = hashed - width - height - width - height;
    }
    return { x, y };
}

/////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// DRAWING FUNCTIONS /////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Handles all canvas drawing.
 * Has to be called anytime something changes.
 */
function draw() {
    requestAnimationFrame(drawCanvas);
}

/**
 * Function that draww all elements of the canvas.
 * Is different from draw(), because draw() is requested by user interaction
 * and drawCanvas() is recursive and not necessarally called by user interaction
 */
function drawCanvas() {
    // Physics
    if (MODE != DRAGGING && MODE != GLOBAL_DRAGGING && MODE != CREATE_LINK) {
        calcBoxesRepulsion();
        calcLinkAttraction();
        moveShapes();
    }

    // Handle transformation (zoom and world move)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#888";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Draw all links
    links.forEach(drawLink);

    // Draw creating link
    if (MODE == CREATE_LINK && createLinkSubject) drawCreatingLink();

    // Draw all boxes
    boxes.forEach(drawBox);

    // Because for information about selection, we do not want them to
    // be affected by zoom in or out, so transformation needs to be reset
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Draw all selected links infos
    const selectedLinks = links.filter((l) => l.selected);
    drawSelectedLinksInfos(selectedLinks);

    // Draw all selected boxes infos
    const selectedBoxes = boxes.filter((b) => b.selected);
    drawSelectedBoxesInfos(selectedBoxes);

    // Reset the transform as before writing infos
    ctx.restore();

    // Recursive mode if the mode is still physics
    if (MODE == PHYSICS) {
        requestAnimationFrame(drawCanvas);
    }
}

/**
 * Draw a individual link on the canvas.
 * This needs to be done before the boxes, so that begins and ends of lines are centered and hidden by boxes.
 *
 * @param {any} link the link to draw.
 */
function drawLink(link) {
    // Context settings
    ctx.strokeStyle = link.selected ? "#CC0000" : "black";
    ctx.fillStyle = link.selected ? "#CC0000" : "black";
    ctx.lineWidth = link.selected ? 7 : 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `14px sans-serif`;

    // Draw the line
    ctx.beginPath();
    ctx.moveTo(link.subject.x, link.subject.y);
    ctx.lineTo(link.object.x, link.object.y);
    ctx.stroke();

    // Find the angle of the line (for later purpose)
    let alpha1 = Math.atan((link.object.y - link.subject.y) / (link.object.x - link.subject.x));
    if (link.object.x < link.subject.x) alpha1 += Math.PI;
    let alpha2 = alpha1 + Math.PI;

    // Set and calculate information needed to draw the arrow (to differentiate incoming and outgoing)
    const r = 30;
    const beta = Math.PI / 15;
    const x3 = r * Math.cos(alpha2 - beta) + (link.subject.x + link.object.x) / 2;
    const y3 = r * Math.sin(alpha2 - beta) + (link.subject.y + link.object.y) / 2;
    const x4 = r * Math.cos(alpha2 + beta) + (link.subject.x + link.object.x) / 2;
    const y4 = r * Math.sin(alpha2 + beta) + (link.subject.y + link.object.y) / 2;

    // Draw the arrow (to differentiate incoming and outgoing)
    if (!link.selected) {
        ctx.beginPath();
        ctx.moveTo((link.subject.x + link.object.x) / 2, (link.subject.y + link.object.y) / 2);
        ctx.lineTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.fill();
    }

    // Draw the text
    // In order to make it along the link, there is the need to translate the origin, rotate to the right angle,
    // That is the reason for the save/restore use: we want to have origin correclty again after drawing
    ctx.save();
    ctx.translate((link.subject.x + link.object.x) / 2, (link.subject.y + link.object.y) / 2 + 20);
    ctx.rotate(alpha1 + (link.subject.x > link.object.x ? Math.PI : 0));
    let text = "";
    if (link.selected) text = link.label;
    else {
        let suffix = !link.cardinality || !link.order || !link.id || !link.predicate ? " ?" : "";
        text = link.predicate + suffix;
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
}

/**
 * Draw the temporary (following the mouse) link creation
 * Active only when creatingLink is on.
 *
 * @returns {void}
 */
function drawCreatingLink() {
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.beginPath();
    ctx.moveTo(createLinkSubject.x, createLinkSubject.y);
    ctx.lineTo(cursorPosWorld.x, cursorPosWorld.y);
    ctx.stroke();
}

/**
 * Draw a individual box on the canvas.
 *
 * @param {any} box the box to draw.
 */
function drawBox(box) {
    ctx.lineWidth = 1;

    // Draw the rectangle
    ctx.fillStyle = box.selected ? "#eee" : "#ccc";
    ctx.strokeStyle = box.selected ? "red" : "black";
    const xBegin = box.x - boxWidth / 2;
    const yBegin = box.y - boxHeight / 2;
    ctx.fillRect(xBegin, yBegin, boxWidth, boxHeight);
    ctx.strokeRect(xBegin, yBegin, boxWidth, boxHeight);

    // Draw the label
    ctx.fillStyle = "black";
    ctx.font = `${textLineHeight}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Handle multilines
    const lines = box.label.split("\n");
    const totalHeight = textLineHeight * lines.length;
    let y = box.y - totalHeight / 2 + textLineHeight / 2;
    for (const line of lines) {
        ctx.fillText(line, box.x, y);
        y += textLineHeight + 5;
    }
}

/**
 * Draw (write) information about all selected links in the
 * top left corner.
 *
 * @param {*} links the selected links to write informations.
 */
function drawSelectedLinksInfos(links) {
    links.forEach((link, i) => {
        let text;
        ctx.fillStyle = "black";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = `14px sans-serif`;

        text = `Link: ${link.subject.name} - ${link.object.name}`;
        ctx.fillText(text, 10, 130 * i + 10);
        text = `id: ${link.id}`;
        ctx.fillText(text, 10, 130 * i + 10 + 20);
        text = `pred: ${link.predicate}`;
        ctx.fillText(text, 10, 130 * i + 10 + 40);
        text = `card: ${link.cardinality}`;
        ctx.fillText(text, 10, 130 * i + 10 + 60);
        text = `order: ${link.order}`;
        ctx.fillText(text, 10, 130 * i + 10 + 80);
    });
}

/**
 * Draw (write) information about all selected boxes in the
 * top left corner.
 *
 * @param {*} boxes the selected boxes to write informations.
 */
function drawSelectedBoxesInfos(boxes) {
    boxes.forEach((box, i) => {
        let text;
        ctx.fillStyle = "black";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = `14px sans-serif`;

        text = `id: ${box.id}`;
        ctx.fillText(text, 10, 60 * i + 10);
        text = `name: ${box.name}`;
        ctx.fillText(text, 10, 60 * i + 10 + 20);
    });
}

/**
 * Calculate all effect of all boxes on each boxes
 * If the effect is too small, cancel it
 */
function calcBoxesRepulsion() {
    boxes.forEach((box) => {
        // For each one of them, apply the force
        boxes.forEach((b) => {
            if (b === box) return;
            // to avoid canvas to teleport or explode: set a minimum distance of 10 pixel between 2 boxes
            const dist = Math.max(getElementDist(b, box), 10);
            const force = boxesRepulsion / (dist * dist);
            const dx = box.x - b.x;
            const dy = box.y - b.y;
            const fx = (force * dx) / dist;
            const fy = (force * dy) / dist;
            box.vx += fx;
            box.vy += fy;
        });
    });
}

/**
 * Calculate the effects of links on boxes
 * If the effect is too small, cancel it
 */
function calcLinkAttraction() {
    links.forEach((link) => {
        const dist = getElementDist(link.subject, link.object);
        const force = linksAttraction * (dist - linksRestLength);
        const dx = link.subject.x - link.object.x;
        const dy = link.subject.y - link.object.y;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        link.subject.vx -= fx;
        link.subject.vy -= fy;
        link.object.vx += fx;
        link.object.vy += fy;
    });
}

/**
 * Depending on velocities, moves all shapes on the map
 */
function moveShapes() {
    let hasMoved = false;
    boxes.forEach((box) => {
        // this is a shortcut, it should be Pythagore
        if (box.vx + box.vy > speedLimit) {
            box.x += box.vx;
            box.y += box.vy;
            box.vx *= velocityDamping;
            box.vy *= velocityDamping;
            hasMoved = true;
        } else {
            box.vx = 0;
            box.vy = 0;
        }
    });
    if (hasMoved) MODE = PHYSICS;
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// MAIN FUNCTIONS /////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////

/**
 * Function that set the canvas, and activate all event listeners.
 * Has to be the first function called by external use.
 *
 * @param {HTMLElement} newCanvas canvas document element to draw things on.
 */
function setCanvas(newCanvas) {
    canvas = newCanvas;
    ctx = newCanvas.getContext("2d", { willReadFrequently: true });

    canvas.addEventListener("click", clickHandler);
    canvas.addEventListener("mousemove", mousemoveHandler);
    canvas.addEventListener("mousedown", mousedownHandler);
    canvas.addEventListener("mouseup", mouseupHandler);
    canvas.addEventListener("keydown", keydownHandler);
    canvas.addEventListener("wheel", scrollHandler);
}

/**
 * Generate a SPARQL string for all boxes (classes) and links (predicates)
 * that are drawn on the chart.
 *
 * @returns {str} The SPARQL string of the chart.
 */
function toSPARQL() {
    let sparql = "";

    // Generate all "is a class" triples
    for (const box of boxes) sparql += `base:${toCamelCase(box.name)} a owl:Class .\n`;
    sparql += "\n";

    // Generate all "is a property" triples
    for (const link of links) sparql += `base:${toCamelCase(link.predicate)} a owl:Property .\n`;
    sparql += "\n";

    // Generate a NodeShape for each boxes (classes)
    for (const box of boxes) {
        // Information about the class itself
        const camelCaseName = toCamelCase(box.name);
        sparql += `base:${camelCaseName}_shape a sh:NodeShape;\n`;
        sparql += `     sh:targetClass ${box.id};\n`;
        sparql += `     sh:name "${box.name}";\n`;
        sparql += `\n`;

        // Find all links (properties) with this box (class) as subject
        // Here we are not interested in links which have the box (class) as object
        // Because the link (property) will in any case be listed in the subject box (class)
        const properties = links.filter((link) => link.subject === box);

        for (const property of properties) {
            // Information about the link (property)
            sparql += `     sh:property [\n`;
            sparql += `         sh:path ${property.id};\n`;
            sparql += `         sh:name "${property.predicate}";\n`;
            // Depending on if the range (object) is a value or a class, it is not the same SHACL property: sh:datatype or sh:class
            sparql += `         sh:${property.object.id.includes("xsd") ? "datatype" : "class"} ${property.object.id};\n`;
            sparql += `         sh:order ${property.order};\n`;

            // Handling of the cardinality
            // Since the cardinality is the one of the object,
            // It has to be set on the subject property information
            if (property.cardinality.includes("..")) {
                const min = property.cardinality.slice(0, property.cardinality.indexOf(".."));
                const max = property.cardinality.slice(property.cardinality.indexOf("..") + 2);
                sparql += `         sh:minCount ${min};\n`;
                if (max != "*") sparql += `         sh:maxCount ${max};\n`;
            } else {
                sparql += `         sh:minCount ${property.cardinality};\n`;
                sparql += `         sh:maxCount ${property.cardinality};\n`;
            }

            // Closing the properties
            sparql += `     ];\n`;
            sparql += "\n";
        }

        // Closing the NodeShape
        sparql += `     .\n`;
        sparql += "\n";
    }

    return sparql;
}

/**
 * Add a list of triples to the existing chart.
 * They will be added randomly, and physics will place them.
 *
 * @param {*} triples The list of triples to add to the chart
 */
function addTriples(triples) {
    triples.forEach((triple) => {
        const subPos = getNewPosition(triple.domain.uri);
        const subject = {
            id: triple.domain.uri,
            name: triple.domain.label,
            label: triple.domain.uri + "\n" + triple.domain.label,
            x: subPos.x,
            y: subPos.y,
            vx: 0,
            vy: 0,
            selected: false,
            type: "box",
        };
        boxes.push(subject);

        const objPos = getNewPosition(triple.range.uri);
        const object = {
            id: triple.range.uri,
            name: triple.range.label,
            label: triple.range.uri + "\n" + triple.range.label,
            x: objPos.x,
            y: objPos.y,
            vx: 0,
            vy: 0,
            selected: false,
            type: "box",
        };
        boxes.push(object);

        let cardinality;
        if (triple.min_count == undefined && triple.max_count == undefined) cardinality = "0..n";
        if (triple.min_count == undefined && triple.max_count != undefined) cardinality = "0.." + triple.max_count;
        if (triple.min_count != undefined && triple.max_count == undefined) cardinality = triple.min_count + "..n";
        if (triple.min_count != undefined && triple.max_count != undefined && triple.min_count != triple.max_count)
            cardinality = triple.min_count + ".." + triple.max_count;
        if (triple.min_count != undefined && triple.max_count != undefined && triple.min_count == triple.max_count) cardinality = triple.max_count;
        const predicate = {
            subject,
            object,
            id: triple.uri,
            predicate: triple.label,
            cardinality: cardinality,
            order: triple.order,
            label: "",
            selected: false,
            type: "link",
        };
        links.push(predicate);
    });

    draw();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// EVENT HANDLING FUNCTION /////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * On click;
 * Act depending on what is clicked.
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function clickHandler(evt) {
    const { x, y } = getMousePos(evt);

    // If the click is actually a drag (detected in "mousedown" event), do nothing
    if (MODE == DRAGGING || MODE == GLOBAL_DRAGGING) {
        MODE = DEFAULT;
        return;
    }

    // In case canvas is in link creation mode: need to select two boxes
    if (MODE == CREATE_LINK) {
        // Save the clicked box for the link creation
        findClickedBoxes(x, y).forEach((box) => {
            if (!createLinkSubject) createLinkSubject = box;
            else if (!createLinkObject) createLinkObject = box;
        });
        // When two link has been selected, create the link
        if (createLinkSubject && createLinkObject) createLink();
    } else {
        // Unselect all boxes and link unless alt or cmd is pressed
        if (!evt.metaKey && !evt.altKey) resetSelection();

        // Select a box: if a (or more) box is (are) selected: links can't be
        findClickedBoxes(x, y).forEach((box) => (box.selected = true));
        const selectedBoxes = boxes.filter((box) => box.selected);
        if (selectedBoxes.length != 0) resetSelection("links");

        // If a box is selected, do not find clicked links (they are behind boxes, and could be clicked through the box)
        if (selectedBoxes.length == 0) {
            // Select a link; if a (or more) link is (are) selected: boxes can't be
            findClickedLinks(x, y).forEach((link) => (link.selected = true));
            const selectedLinks = links.filter((link) => link.selected);
            if (selectedLinks.length != 0) resetSelection("boxes");
        }
    }

    draw();
}

/**
 * On mouse move;
 * Save cursor position and if activated, handles dragging.
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function mousemoveHandler(evt) {
    // Save the current cursor position so that it is always up to date and
    // also available for event that do not have cursor position in them
    // cursorCanvas is needed for the zoom in/out and dragging the world with the mouse
    // cursorCanvas are the coordinates of the mouse, in the canvas world POV
    cursorPosWorld = getMousePos(evt);
    cursorPosCanvas = getMousePosCanvas(evt);

    // If user is dragging a selection, move selection accordingly

    let toDrag = undefined;
    if (MODE == DRAGGING) toDrag = boxes.filter((box) => box.selected);
    if (MODE == GLOBAL_DRAGGING) toDrag = boxes;

    if (toDrag) {
        // Get the move vector since mouseDown
        const vecX = cursorPosWorld.x - beginPos.x;
        const vecY = cursorPosWorld.y - beginPos.y;

        // Apply vector to all dragged element
        toDrag.forEach((dragElement) => {
            dragElement.x = dragElement.prevPosX + vecX;
            dragElement.y = dragElement.prevPosY + vecY;
        });

        draw();
    }

    if (MODE == CREATE_LINK) draw();
}

/**
 * On mouse down;
 * Save positions: of the cursor, and all other needed boxes position for dragging.
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function mousedownHandler(evt) {
    if (MODE == CREATE_LINK) return;

    // Save position on mousedown to check on mouseup if it was a click or a drag
    mousedownPos = { ...cursorPosWorld };

    // Get all selected boxes
    const selected = boxes.filter((box) => box.selected);

    beginPos = { ...cursorPosWorld };
    if (selected.length > 0) {
        // If there is some selected boxes, save their initial position
        MODE = DRAGGING;
        selected.forEach((box) => {
            box.prevPosX = box.x;
            box.prevPosY = box.y;
        });
    } else {
        // Otherwise save initial position of all boxes
        MODE = GLOBAL_DRAGGING;
        boxes.forEach((box) => {
            box.prevPosX = box.x;
            box.prevPosY = box.y;
        });
    }
}

/**
 * On mouse up;
 * Reset all dragging.
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function mouseupHandler(evt) {
    const { x, y } = getMousePos(evt);

    // Detect if since the mousedown was a click or a drag
    // If it was a drag (ie position between mousedown and mouseup is bigger than X)
    const dist = Math.sqrt((mousedownPos.x - x) * (mousedownPos.x - x) + (mousedownPos.y - y) * (mousedownPos.y - y));
    if (dist <= 1) MODE = DEFAULT;

    // Reset the dragging and clean the selected boxes
    if (MODE == DRAGGING) {
        beginPos = undefined;
        boxes
            .filter((box) => box.selected)
            .forEach((box) => {
                delete box.prevPosX;
                delete box.prevPosY;
            });

        draw();
    }

    // Reset the dragging and clean all boxes
    if (MODE == GLOBAL_DRAGGING) {
        beginPos = undefined;
        boxes.forEach((box) => {
            delete box.prevPosX;
            delete box.prevPosY;
        });

        draw();
    }
}

/**
 * On key down
 * Handles actions when keyboard is hit, be it shortcuts or label writing.
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function keydownHandler(evt) {
    // Look for all selected items, be their boxes or links
    const selected = boxes.filter((box) => box.selected).concat(links.filter((link) => link.selected));

    // Cancel key
    if (evt.key == "Escape") resetSelection();

    // If nothing is selected: Normal mmode
    if (selected.length == 0) {
        // Add a new box
        if (evt.key == "c") createBox();
        // Add a new link
        if (evt.key == "r") MODE = CREATE_LINK;
        // Log the sparql
        if (evt.key == "P") console.log(toSPARQL());
    } else {
        // If something is selected and Backspace: remove a character from the label
        if (evt.key === "Backspace")
            selected.forEach((boxOrLink) => {
                boxOrLink.label = boxOrLink.label.slice(0, -1);
                if (boxOrLink.type == "link") parseLinkFromLabel(boxOrLink);
                if (boxOrLink.type == "box") parseBoxFromLabel(boxOrLink);
            });
        // If something is selected and Delete is clicked:
        // Remove selected ones from the chart
        else if (evt.key == "Delete")
            selected.forEach((boxOrLink) => {
                if (boxOrLink.type == "box") deleteBox(boxOrLink);
                if (boxOrLink.type == "link") deleteLink(boxOrLink);
            });
        // Special case for the "Enter" key: it has to be treated as a normal char: new line
        else if (evt.key == "Enter") selected.forEach((boxOrLink) => (boxOrLink.label += "\n"));
        // If it is a "normal key", just add it to the label, and parse it
        else if (evt.key.length === 1) {
            selected.forEach((boxOrLink) => {
                boxOrLink.label += evt.key;
                if (boxOrLink.type == "link") parseLinkFromLabel(boxOrLink);
                if (boxOrLink.type == "box") parseBoxFromLabel(boxOrLink);
            });
        }
    }

    draw();
}

/**
 * On wheel;
 * Make the canvas zoom in or out
 *
 * @param {MouseEvent} event - The event triggered by the user.
 * @returns {void}
 */
function scrollHandler(evt) {
    // Avoid the page scrolling (when focus is on canvas)
    evt.preventDefault();

    // Calculate the new zoom value
    const zoom = evt.deltaY < 0 ? 1.03 : 0.97;

    // Calculate needed constants for setTransform
    offsetX = cursorPosCanvas.x - (cursorPosCanvas.x - offsetX) * zoom;
    offsetY = cursorPosCanvas.y - (cursorPosCanvas.y - offsetY) * zoom;
    scale *= zoom;

    draw();
}

// To not include
export default {
    setCanvas,
    draw,
    toSPARQL,
    addTriples,
};

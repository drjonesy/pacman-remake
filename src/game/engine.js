import { AssetStore, Renderer } from './renderer.js';

const MAZE_IMAGE = 'app/style/graphics/spriteSheets/maze/maze_blue.svg';

// The maze flashes white when a level is cleared. maze_white.svg was referenced
// by the original code but never shipped, so the flash is a tint instead.
const MAZE_FLASH_TINT = '#fff';

// The maze is 28 tiles wide and 31 tall. The UI stacked around it - the score
// row, the gap beneath it, and the lives/fruit row - is sized in tiles too, so
// the whole board can be scaled as one unit. See determineScale.
const MAZE_COLUMNS = 28;
const MAZE_ROWS = 31;
const SCORE_ROW_TILES = 3;
const SCORE_GAP_TILES = 1;
const BOTTOM_ROW_TILES = 2;
const TOTAL_UI_TILES = SCORE_ROW_TILES + SCORE_GAP_TILES
    + MAZE_ROWS + BOTTOM_ROW_TILES;

// Fraction of the viewport the on-screen d-pad occupies in portrait.
const PORTRAIT_CONTROLS_FRACTION = 0.22;

function absorbEvent_(event) {
    var e = event || window.event;
    e.preventDefault && e.preventDefault();
    e.stopPropagation && e.stopPropagation();
    e.cancelBubble = true;
    e.returnValue = false;
    return false;
}


function preventLongPressMenu(node) {
    node.ontouchstart = absorbEvent_;
    node.ontouchmove = absorbEvent_;
    node.ontouchend = absorbEvent_;
    node.ontouchcancel = absorbEvent_;
}


class Ghost {
    constructor(
        scaledTileSize, mazeArray, pacman, name, level, characterUtil, blinky,
    ) {
        this.scaledTileSize = scaledTileSize;
        this.mazeArray = mazeArray;
        this.pacman = pacman;
        this.name = name;
        this.level = level;
        this.characterUtil = characterUtil;
        this.blinky = blinky;

        this.reset();
    }

    /**
     * Rests the character to its default state
     * @param {Boolean} fullGameReset
     */
    reset(fullGameReset) {
        if (fullGameReset) {
            delete this.defaultSpeed;
            delete this.cruiseElroy;
        }

        this.setDefaultMode();
        this.setMovementStats(this.pacman, this.name, this.level);
        this.setSpriteAnimationStats();
        this.setStyleMeasurements(this.scaledTileSize);
        this.setDefaultPosition(this.scaledTileSize, this.name);
        this.setSpriteSheet(this.name, this.direction, this.mode);
    }

    /**
     * Sets the default mode and idleMode behavior
     */
    setDefaultMode() {
        this.allowCollision = true;
        this.defaultMode = 'scatter';
        this.mode = 'scatter';
        if (this.name !== 'blinky') {
            this.idleMode = 'idle';
        }
    }

    /**
     * Sets various properties related to the ghost's movement
     * @param {Object} pacman - Pacman's speed is used as the base for the ghosts' speeds
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     */
    setMovementStats(pacman, name, level) {
        const pacmanSpeed = pacman.velocityPerMs;
        const levelAdjustment = level / 100;

        this.slowSpeed = pacmanSpeed * (0.75 + levelAdjustment);
        this.mediumSpeed = pacmanSpeed * (0.875 + levelAdjustment);
        this.fastSpeed = pacmanSpeed * (1 + levelAdjustment);

        if (!this.defaultSpeed) {
            this.defaultSpeed = this.slowSpeed;
        }

        this.scaredSpeed = pacmanSpeed * 0.5;
        this.transitionSpeed = pacmanSpeed * 0.4;
        this.eyeSpeed = pacmanSpeed * 2;

        this.velocityPerMs = this.defaultSpeed;
        this.moving = false;

        switch (name) {
            case 'blinky':
                this.defaultDirection = this.characterUtil.directions.left;
                break;
            case 'pinky':
                this.defaultDirection = this.characterUtil.directions.down;
                break;
            case 'inky':
                this.defaultDirection = this.characterUtil.directions.up;
                break;
            case 'clyde':
                this.defaultDirection = this.characterUtil.directions.up;
                break;
            default:
                this.defaultDirection = this.characterUtil.directions.left;
                break;
        }
        this.direction = this.defaultDirection;
    }

    /**
     * Sets values pertaining to the ghost's spritesheet animation
     */
    setSpriteAnimationStats() {
        this.display = true;
        this.visible = true;
        this.loopAnimation = true;
        this.animate = true;
        this.msBetweenSprites = 250;
        this.msSinceLastSprite = 0;
        this.spriteFrames = 2;
        this.backgroundOffsetPixels = 0;
    }

    /**
     * Sets the ghost's rendered size
     * @param {number} scaledTileSize - The dimensions of a single tile
     */
    setStyleMeasurements(scaledTileSize) {
        // The ghosts are the size of 2x2 game tiles.
        this.measurement = scaledTileSize * 2;
    }

    /**
     * Sets the default position and direction for the ghosts at the game's start
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     */
    setDefaultPosition(scaledTileSize, name) {
        switch (name) {
            case 'blinky':
                this.defaultPosition = {
                    top: scaledTileSize * 10.5,
                    left: scaledTileSize * 13,
                };
                break;
            case 'pinky':
                this.defaultPosition = {
                    top: scaledTileSize * 13.5,
                    left: scaledTileSize * 13,
                };
                break;
            case 'inky':
                this.defaultPosition = {
                    top: scaledTileSize * 13.5,
                    left: scaledTileSize * 11,
                };
                break;
            case 'clyde':
                this.defaultPosition = {
                    top: scaledTileSize * 13.5,
                    left: scaledTileSize * 15,
                };
                break;
            default:
                this.defaultPosition = {
                    top: 0,
                    left: 0,
                };
                break;
        }
        this.position = Object.assign({}, this.defaultPosition);
        this.oldPosition = Object.assign({}, this.position);
    }

    /**
     * Chooses a movement Spritesheet depending upon direction
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     */
    setSpriteSheet(name, direction, mode) {
        let emotion = '';
        if (this.defaultSpeed !== this.slowSpeed) {
            emotion = (this.defaultSpeed === this.mediumSpeed)
                ? '_annoyed' : '_angry';
        }

        const base = 'app/style/graphics/spriteSheets/characters/ghosts/';

        if (mode === 'scared') {
            this.sheet = `${base}scared_${this.scaredColor}.svg`;
        } else if (mode === 'eyes') {
            this.sheet = `${base}eyes_${direction}.svg`;
        } else {
            this.sheet = `${base}${name}/${name}_${direction}${emotion}.svg`;
        }
    }

    /**
     * Checks to see if the ghost is currently in the 'tunnels' on the outer edges of the maze
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @returns {Boolean}
     */
    isInTunnel(gridPosition) {
        return (
            gridPosition.y === 14
            && (gridPosition.x < 6 || gridPosition.x > 21)
        );
    }

    /**
     * Checks to see if the ghost is currently in the 'Ghost House' in the center of the maze
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @returns {Boolean}
     */
    isInGhostHouse(gridPosition) {
        return (
            (gridPosition.x > 9 && gridPosition.x < 18)
            && (gridPosition.y > 11 && gridPosition.y < 17)
        );
    }

    /**
     * Checks to see if the tile at the given coordinates of the Maze is an open position
     * @param {Array} mazeArray - 2D array representing the game board
     * @param {number} y - The target row
     * @param {number} x - The target column
     * @returns {(false | { x: number, y: number})} - x-y pair if the tile is free, false otherwise
     */
    getTile(mazeArray, y, x) {
        let tile = false;

        if (mazeArray[y] && mazeArray[y][x] && mazeArray[y][x] !== 'X') {
            tile = {
                x,
                y,
            };
        }

        return tile;
    }

    /**
     * Returns a list of all of the possible moves for the ghost to make on the next turn
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {Array} mazeArray - 2D array representing the game board
     * @returns {object}
     */
    determinePossibleMoves(gridPosition, direction, mazeArray) {
        const { x, y } = gridPosition;

        const possibleMoves = {
            up: this.getTile(mazeArray, y - 1, x),
            down: this.getTile(mazeArray, y + 1, x),
            left: this.getTile(mazeArray, y, x - 1),
            right: this.getTile(mazeArray, y, x + 1),
        };

        // Ghosts are not allowed to turn around at crossroads
        possibleMoves[this.characterUtil.getOppositeDirection(direction)] = false;

        Object.keys(possibleMoves).forEach((tile) => {
            if (possibleMoves[tile] === false) {
                delete possibleMoves[tile];
            }
        });

        return possibleMoves;
    }

    /**
     * Uses the Pythagorean Theorem to measure the distance between a given postion and Pacman
     * @param {({x: number, y: number})} position - An x-y position on the 2D Maze Array
     * @param {({x: number, y: number})} pacman - Pacman's current x-y position on the 2D Maze Array
     * @returns {number}
     */
    calculateDistance(position, pacman) {
        return Math.sqrt(
            ((position.x - pacman.x) ** 2) + ((position.y - pacman.y) ** 2),
        );
    }

    /**
     * Gets a position a number of spaces in front of Pacman's direction
     * @param {({x: number, y: number})} pacmanGridPosition
     * @param {number} spaces
     */
    getPositionInFrontOfPacman(pacmanGridPosition, spaces) {
        const target = Object.assign({}, pacmanGridPosition);
        const pacDirection = this.pacman.direction;
        const propToChange = (pacDirection === 'up' || pacDirection === 'down')
            ? 'y' : 'x';
        const tileOffset = (pacDirection === 'up' || pacDirection === 'left')
            ? (spaces * -1) : spaces;
        target[propToChange] += tileOffset;

        return target;
    }

    /**
     * Determines Pinky's target, which is four tiles in front of Pacman's direction
     * @param {({x: number, y: number})} pacmanGridPosition
     * @returns {({x: number, y: number})}
     */
    determinePinkyTarget(pacmanGridPosition) {
        return this.getPositionInFrontOfPacman(
            pacmanGridPosition, 4,
        );
    }

    /**
     * Determines Inky's target, which is a mirror image of Blinky's position
     * reflected across a point two tiles in front of Pacman's direction.
     * Example @ app\style\graphics\spriteSheets\references\inky_target.png
     * @param {({x: number, y: number})} pacmanGridPosition
     * @returns {({x: number, y: number})}
     */
    determineInkyTarget(pacmanGridPosition) {
        const blinkyGridPosition = this.characterUtil.determineGridPosition(
            this.blinky.position, this.scaledTileSize,
        );
        const pivotPoint = this.getPositionInFrontOfPacman(
            pacmanGridPosition, 2,
        );
        return {
            x: pivotPoint.x + (pivotPoint.x - blinkyGridPosition.x),
            y: pivotPoint.y + (pivotPoint.y - blinkyGridPosition.y),
        };
    }

    /**
     * Clyde targets Pacman when the two are far apart, but retreats to the
     * lower-left corner when the two are within eight tiles of each other
     * @param {({x: number, y: number})} gridPosition
     * @param {({x: number, y: number})} pacmanGridPosition
     * @returns {({x: number, y: number})}
     */
    determineClydeTarget(gridPosition, pacmanGridPosition) {
        const distance = this.calculateDistance(gridPosition, pacmanGridPosition);
        return (distance > 8) ? pacmanGridPosition : { x: 0, y: 30 };
    }

    /**
     * Determines the appropriate target for the ghost's AI
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @param {({x: number, y: number})} pacmanGridPosition - x-y position on the 2D Maze Array
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @returns {({x: number, y: number})}
     */
    getTarget(name, gridPosition, pacmanGridPosition, mode) {
        // Ghosts return to the ghost-house after eaten
        if (mode === 'eyes') {
            return { x: 13.5, y: 10 };
        }

        // Ghosts run from Pacman if scared
        if (mode === 'scared') {
            return pacmanGridPosition;
        }

        // Ghosts seek out corners in Scatter mode
        if (mode === 'scatter') {
            switch (name) {
                case 'blinky':
                    // Blinky will chase Pacman, even in Scatter mode, if he's in Cruise Elroy form
                    return (this.cruiseElroy ? pacmanGridPosition : { x: 27, y: 0 });
                case 'pinky':
                    return { x: 0, y: 0 };
                case 'inky':
                    return { x: 27, y: 30 };
                case 'clyde':
                    return { x: 0, y: 30 };
                default:
                    return { x: 0, y: 0 };
            }
        }

        switch (name) {
            // Blinky goes after Pacman's position
            case 'blinky':
                return pacmanGridPosition;
            case 'pinky':
                return this.determinePinkyTarget(pacmanGridPosition);
            case 'inky':
                return this.determineInkyTarget(pacmanGridPosition);
            case 'clyde':
                return this.determineClydeTarget(gridPosition, pacmanGridPosition);
            default:
                // TODO: Other ghosts
                return pacmanGridPosition;
        }
    }

    /**
     * Calls the appropriate function to determine the best move depending on the ghost's name
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     * @param {Object} possibleMoves - All of the moves the ghost could choose to make this turn
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @param {({x: number, y: number})} pacmanGridPosition - x-y position on the 2D Maze Array
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @returns {('up'|'down'|'left'|'right')}
     */
    determineBestMove(
        name, possibleMoves, gridPosition, pacmanGridPosition, mode,
    ) {
        let bestDistance = (mode === 'scared') ? 0 : Infinity;
        let bestMove;
        const target = this.getTarget(name, gridPosition, pacmanGridPosition, mode);

        Object.keys(possibleMoves).forEach((move) => {
            const distance = this.calculateDistance(
                possibleMoves[move], target,
            );
            const betterMove = (mode === 'scared')
                ? (distance > bestDistance)
                : (distance < bestDistance);

            if (betterMove) {
                bestDistance = distance;
                bestMove = move;
            }
        });

        return bestMove;
    }

    /**
     * Determines the best direction for the ghost to travel in during the current frame
     * @param {('inky'|'blinky'|'pinky'|'clyde')} name - The name of the current ghost
     * @param {({x: number, y: number})} gridPosition - The current x-y position on the 2D Maze Array
     * @param {({x: number, y: number})} pacmanGridPosition - x-y position on the 2D Maze Array
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {Array} mazeArray - 2D array representing the game board
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @returns {('up'|'down'|'left'|'right')}
     */
    determineDirection(
        name, gridPosition, pacmanGridPosition, direction, mazeArray, mode,
    ) {
        let newDirection = direction;
        const possibleMoves = this.determinePossibleMoves(
            gridPosition, direction, mazeArray,
        );

        if (Object.keys(possibleMoves).length === 1) {
            [newDirection] = Object.keys(possibleMoves);
        } else if (Object.keys(possibleMoves).length > 1) {
            newDirection = this.determineBestMove(
                name, possibleMoves, gridPosition, pacmanGridPosition, mode,
            );
        }

        return newDirection;
    }

    /**
     * Handles movement for idle Ghosts in the Ghost House
     * @param {*} elapsedMs
     * @param {*} position
     * @param {*} velocity
     * @returns {({ top: number, left: number})}
     */
    handleIdleMovement(elapsedMs, position, velocity) {
        const newPosition = Object.assign({}, this.position);

        if (position.y <= 13.5) {
            this.direction = this.characterUtil.directions.down;
        } else if (position.y >= 14.5) {
            this.direction = this.characterUtil.directions.up;
        }

        if (this.idleMode === 'leaving') {
            if (position.x === 13.5 && (position.y > 10.8 && position.y < 11)) {
                this.idleMode = undefined;
                newPosition.top = this.scaledTileSize * 10.5;
                this.direction = this.characterUtil.directions.left;
                window.dispatchEvent(new Event('releaseGhost'));
            } else if (position.x > 13.4 && position.x < 13.6) {
                newPosition.left = this.scaledTileSize * 13;
                this.direction = this.characterUtil.directions.up;
            } else if (position.y > 13.9 && position.y < 14.1) {
                newPosition.top = this.scaledTileSize * 13.5;
                this.direction = (position.x < 13.5)
                    ? this.characterUtil.directions.right
                    : this.characterUtil.directions.left;
            }
        }

        newPosition[this.characterUtil.getPropertyToChange(this.direction)]
            += this.characterUtil.getVelocity(this.direction, velocity) * elapsedMs;

        return newPosition;
    }

    /**
     * Sets idleMode to 'leaving', allowing the ghost to leave the Ghost House
     */
    endIdleMode() {
        this.idleMode = 'leaving';
    }

    /**
     * Handle the ghost's movement when it is snapped to the x-y grid of the Maze Array
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     * @param {({x: number, y: number})} gridPosition - x-y position during the current frame
     * @param {number} velocity - The distance the character should travel in a single millisecond
     * @param {({x: number, y: number})} pacmanGridPosition - x-y position on the 2D Maze Array
     * @returns {({ top: number, left: number})}
     */
    handleSnappedMovement(elapsedMs, gridPosition, velocity, pacmanGridPosition) {
        const newPosition = Object.assign({}, this.position);

        this.direction = this.determineDirection(
            this.name, gridPosition, pacmanGridPosition, this.direction,
            this.mazeArray, this.mode,
        );
        newPosition[this.characterUtil.getPropertyToChange(this.direction)]
            += this.characterUtil.getVelocity(this.direction, velocity) * elapsedMs;

        return newPosition;
    }

    /**
     * Determines if an eaten ghost is at the entrance of the Ghost House
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @param {({x: number, y: number})} position - x-y position during the current frame
     * @returns {Boolean}
     */
    enteringGhostHouse(mode, position) {
        return (
            mode === 'eyes'
            && position.y === 11
            && (position.x > 13.4 && position.x < 13.6)
        );
    }

    /**
     * Determines if an eaten ghost has reached the center of the Ghost House
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @param {({x: number, y: number})} position - x-y position during the current frame
     * @returns {Boolean}
     */
    enteredGhostHouse(mode, position) {
        return (
            mode === 'eyes'
            && position.x === 13.5
            && (position.y > 13.8 && position.y < 14.2)
        );
    }

    /**
     * Determines if a restored ghost is at the exit of the Ghost House
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @param {({x: number, y: number})} position - x-y position during the current frame
     * @returns {Boolean}
     */
    leavingGhostHouse(mode, position) {
        return (
            mode !== 'eyes'
            && position.x === 13.5
            && (position.y > 10.8 && position.y < 11)
        );
    }

    /**
     * Handles entering and leaving the Ghost House after a ghost is eaten
     * @param {({x: number, y: number})} gridPosition - x-y position during the current frame
     * @returns {({x: number, y: number})}
     */
    handleGhostHouse(gridPosition) {
        const gridPositionCopy = Object.assign({}, gridPosition);

        if (this.enteringGhostHouse(this.mode, gridPosition)) {
            this.direction = this.characterUtil.directions.down;
            gridPositionCopy.x = 13.5;
            this.position = this.characterUtil.snapToGrid(
                gridPositionCopy, this.direction, this.scaledTileSize,
            );
        }

        if (this.enteredGhostHouse(this.mode, gridPosition)) {
            this.direction = this.characterUtil.directions.up;
            gridPositionCopy.y = 14;
            this.position = this.characterUtil.snapToGrid(
                gridPositionCopy, this.direction, this.scaledTileSize,
            );
            this.mode = this.defaultMode;
            window.dispatchEvent(new Event('restoreGhost'));
        }

        if (this.leavingGhostHouse(this.mode, gridPosition)) {
            gridPositionCopy.y = 11;
            this.position = this.characterUtil.snapToGrid(
                gridPositionCopy, this.direction, this.scaledTileSize,
            );
            this.direction = this.characterUtil.directions.left;
        }

        return gridPositionCopy;
    }

    /**
     * Handle the ghost's movement when it is inbetween tiles on the x-y grid of the Maze Array
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     * @param {({x: number, y: number})} gridPosition - x-y position during the current frame
     * @param {number} velocity - The distance the character should travel in a single millisecond
     * @returns {({ top: number, left: number})}
     */
    handleUnsnappedMovement(elapsedMs, gridPosition, velocity) {
        const gridPositionCopy = this.handleGhostHouse(gridPosition);

        const desired = this.characterUtil.determineNewPositions(
            this.position, this.direction, velocity, elapsedMs, this.scaledTileSize,
        );

        if (this.characterUtil.changingGridPosition(
            gridPositionCopy, desired.newGridPosition,
        )) {
            return this.characterUtil.snapToGrid(
                gridPositionCopy, this.direction, this.scaledTileSize,
            );
        }

        return desired.newPosition;
    }

    /**
     * Determines the new Ghost position
     * @param {number} elapsedMs
     * @returns {({ top: number, left: number})}
     */
    handleMovement(elapsedMs) {
        let newPosition;

        const gridPosition = this.characterUtil.determineGridPosition(
            this.position, this.scaledTileSize,
        );
        const pacmanGridPosition = this.characterUtil.determineGridPosition(
            this.pacman.position, this.scaledTileSize,
        );
        const velocity = this.determineVelocity(
            gridPosition, this.mode,
        );

        if (this.idleMode) {
            newPosition = this.handleIdleMovement(
                elapsedMs, gridPosition, velocity,
            );
        } else if (this.characterUtil.isSnappedToGrid(
            this.position, gridPosition, this.direction, this.scaledTileSize,
        )) {
            newPosition = this.handleSnappedMovement(
                elapsedMs, gridPosition, velocity, pacmanGridPosition,
            );
        } else {
            newPosition = this.handleUnsnappedMovement(
                elapsedMs, gridPosition, velocity,
            );
        }

        newPosition = this.characterUtil.handleWarp(
            newPosition, this.scaledTileSize, this.mazeArray,
        );

        this.checkCollision(gridPosition, pacmanGridPosition);

        return newPosition;
    }

    /**
     * Changes the defaultMode to chase or scatter, and turns the ghost around
     * if needed
     * @param {('chase'|'scatter')} newMode
     */
    changeMode(newMode) {
        this.defaultMode = newMode;

        const gridPosition = this.characterUtil.determineGridPosition(
            this.position, this.scaledTileSize,
        );

        if ((this.mode === 'chase' || this.mode === 'scatter')
            && !this.cruiseElroy) {
            this.mode = newMode;

            if (!this.isInGhostHouse(gridPosition)) {
                this.direction = this.characterUtil.getOppositeDirection(
                    this.direction,
                );
            }
        }
    }

    /**
     * Toggles a scared ghost between blue and white, then updates its spritsheet
     */
    toggleScaredColor() {
        this.scaredColor = (this.scaredColor === 'blue')
            ? 'white' : 'blue';
        this.setSpriteSheet(this.name, this.direction, this.mode);
    }

    /**
     * Sets the ghost's mode to SCARED, turns the ghost around,
     * and changes spritesheets accordingly
     */
    becomeScared() {
        const gridPosition = this.characterUtil.determineGridPosition(
            this.position, this.scaledTileSize,
        );

        if (this.mode !== 'eyes') {
            if (!this.isInGhostHouse(gridPosition) && this.mode !== 'scared') {
                this.direction = this.characterUtil.getOppositeDirection(
                    this.direction,
                );
            }
            this.mode = 'scared';
            this.scaredColor = 'blue';
            this.setSpriteSheet(this.name, this.direction, this.mode);
        }
    }

    /**
     * Returns the scared ghost to chase/scatter mode and sets its spritesheet
     */
    endScared() {
        this.mode = this.defaultMode;
        this.setSpriteSheet(this.name, this.direction, this.mode);
    }

    /**
     * Speeds up the ghost (used for Blinky as Pacdots are eaten)
     */
    speedUp() {
        this.cruiseElroy = true;

        if (this.defaultSpeed === this.slowSpeed) {
            this.defaultSpeed = this.mediumSpeed;
        } else if (this.defaultSpeed === this.mediumSpeed) {
            this.defaultSpeed = this.fastSpeed;
        }
    }

    /**
     * Resets defaultSpeed to slow and updates the spritesheet
     */
    resetDefaultSpeed() {
        this.defaultSpeed = this.slowSpeed;
        this.cruiseElroy = false;
        this.setSpriteSheet(this.name, this.direction, this.mode);
    }

    /**
     * Sets a flag to indicate when the ghost should pause its movement
     * @param {Boolean} newValue
     */
    pause(newValue) {
        this.paused = newValue;
    }

    /**
     * Checks if the ghost contacts Pacman - starts the death sequence if so
     * @param {({x: number, y: number})} position - An x-y position on the 2D Maze Array
     * @param {({x: number, y: number})} pacman - Pacman's current x-y position on the 2D Maze Array
     */
    checkCollision(position, pacman) {
        if (this.calculateDistance(position, pacman) < 1
            && this.mode !== 'eyes'
            && this.allowCollision) {
            if (this.mode === 'scared') {
                window.dispatchEvent(new CustomEvent('eatGhost', {
                    detail: {
                        ghost: this,
                    },
                }));
                this.mode = 'eyes';
            } else {
                window.dispatchEvent(new Event('deathSequence'));
            }
        }
    }

    /**
     * Determines the appropriate speed for the ghost
     * @param {({x: number, y: number})} position - An x-y position on the 2D Maze Array
     * @param {('chase'|'scatter'|'scared'|'eyes')} mode - The character's behavior mode
     * @returns {number}
     */
    determineVelocity(position, mode) {
        if (mode === 'eyes') {
            return this.eyeSpeed;
        }

        if (this.paused) {
            return 0;
        }

        if (this.isInTunnel(position) || this.isInGhostHouse(position)) {
            return this.transitionSpeed;
        }

        if (mode === 'scared') {
            return this.scaredSpeed;
        }

        return this.defaultSpeed;
    }

    /**
     * Draws the ghost, hiding it if there is a stutter, and animates the spritesheet
     * @param {number} interp - The animation accuracy as a percentage
     * @param {Renderer} renderer
     */
    draw(interp, renderer) {
        const updated = this.characterUtil.advanceSpriteSheet(this);
        this.msSinceLastSprite = updated.msSinceLastSprite;
        this.backgroundOffsetPixels = updated.backgroundOffsetPixels;

        this.visible = this.display
            && !this.characterUtil.checkForStutter(
                this.position, this.oldPosition, this.scaledTileSize,
            );

        if (!this.visible) return;

        const top = this.characterUtil.calculateNewDrawValue(
            interp, 'top', this.oldPosition, this.position,
        );
        const left = this.characterUtil.calculateNewDrawValue(
            interp, 'left', this.oldPosition, this.position,
        );
        const frame = this.backgroundOffsetPixels / this.measurement;

        renderer.drawFrame(
            this.sheet, frame, this.spriteFrames, left, top, this.measurement,
        );
    }

    /**
     * Handles movement logic for the ghost
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     */
    update(elapsedMs) {
        this.oldPosition = Object.assign({}, this.position);

        if (this.moving) {
            this.position = this.handleMovement(elapsedMs);
            this.setSpriteSheet(this.name, this.direction, this.mode);
            this.msSinceLastSprite += elapsedMs;
        }
    }
}


class Pacman {
    constructor(scaledTileSize, mazeArray, characterUtil) {
        this.scaledTileSize = scaledTileSize;
        this.mazeArray = mazeArray;
        this.characterUtil = characterUtil;

        this.reset();
    }

    /**
     * Rests the character to its default state
     */
    reset() {
        this.setMovementStats(this.scaledTileSize);
        this.setSpriteAnimationStats();
        this.setStyleMeasurements(this.scaledTileSize);
        this.setDefaultPosition(this.scaledTileSize);
        this.setSpriteSheet(this.direction);
        this.setArrowSheet(this.direction);
    }

    /**
     * Sets various properties related to Pacman's movement
     * @param {number} scaledTileSize - The dimensions of a single tile
     */
    setMovementStats(scaledTileSize) {
        this.velocityPerMs = this.calculateVelocityPerMs(scaledTileSize);
        this.desiredDirection = this.characterUtil.directions.left;
        this.direction = this.characterUtil.directions.left;
        this.moving = false;
    }

    /**
     * Sets values pertaining to Pacman's spritesheet animation
     */
    setSpriteAnimationStats() {
        this.specialAnimation = false;
        this.display = true;
        this.visible = true;
        this.animate = true;
        this.loopAnimation = true;
        this.msBetweenSprites = 50;
        this.msSinceLastSprite = 0;
        this.spriteFrames = 4;
        this.backgroundOffsetPixels = 0;
    }

    /**
     * Sets the rendered size for Pacman and Pacman's Arrow
     * @param {number} scaledTileSize - The dimensions of a single tile
     */
    setStyleMeasurements(scaledTileSize) {
        this.measurement = scaledTileSize * 2;
        this.arrowMeasurement = this.measurement * 2;
    }

    /**
     * Sets the default position and direction for Pacman at the game's start
     * @param {number} scaledTileSize - The dimensions of a single tile
     */
    setDefaultPosition(scaledTileSize) {
        this.defaultPosition = {
            top: scaledTileSize * 22.5,
            left: scaledTileSize * 13,
        };
        this.position = Object.assign({}, this.defaultPosition);
        this.oldPosition = Object.assign({}, this.position);
    }

    /**
     * Calculates how fast Pacman should move in a millisecond
     * @param {number} scaledTileSize - The dimensions of a single tile
     */
    calculateVelocityPerMs(scaledTileSize) {
        // In the original game, Pacman moved at 11 tiles per second.
        const velocityPerSecond = scaledTileSize * 11;
        return velocityPerSecond / 1000;
    }

    /**
     * Chooses a movement Spritesheet depending upon direction
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     */
    setSpriteSheet(direction) {
        this.sheet = 'app/style/graphics/spriteSheets/characters/pacman/'
            + `pacman_${direction}.svg`;
    }

    /**
     * Chooses the leading arrow sprite depending upon direction
     * @param {('up'|'down'|'left'|'right')} direction
     */
    setArrowSheet(direction) {
        this.arrowSheet = 'app/style/graphics/spriteSheets/characters/pacman/'
            + `arrow_${direction}.svg`;
    }

    prepDeathAnimation() {
        this.loopAnimation = false;
        this.msBetweenSprites = 125;
        this.spriteFrames = 12;
        this.specialAnimation = true;
        this.backgroundOffsetPixels = 0;
        this.sheet = 'app/style/graphics/spriteSheets/characters/pacman/'
            + 'pacman_death.svg';
        this.arrowSheet = null;
    }

    /**
     * Changes Pacman's desiredDirection, updates the PacmanArrow sprite, and sets moving to true
     * @param {Event} e - The keydown event to evaluate
     * @param {Boolean} startMoving - If true, Pacman will move upon key press
     */
    changeDirection(newDirection, startMoving) {
        this.desiredDirection = newDirection;
        this.setArrowSheet(this.desiredDirection);

        if (startMoving) {
            this.moving = true;
        }
    }

    /**
     * Handle Pacman's movement when he is snapped to the x-y grid of the Maze Array
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     * @returns {({ top: number, left: number})}
     */
    handleSnappedMovement(elapsedMs) {
        const desired = this.characterUtil.determineNewPositions(
            this.position, this.desiredDirection, this.velocityPerMs,
            elapsedMs, this.scaledTileSize,
        );
        const alternate = this.characterUtil.determineNewPositions(
            this.position, this.direction, this.velocityPerMs,
            elapsedMs, this.scaledTileSize,
        );

        if (this.characterUtil.checkForWallCollision(
            desired.newGridPosition, this.mazeArray, this.desiredDirection,
        )) {
            if (this.characterUtil.checkForWallCollision(
                alternate.newGridPosition, this.mazeArray, this.direction,
            )) {
                this.moving = false;
                return this.position;
            }
            return alternate.newPosition;
        }
        this.direction = this.desiredDirection;
        this.setSpriteSheet(this.direction);
        return desired.newPosition;
    }

    /**
     * Handle Pacman's movement when he is inbetween tiles on the x-y grid of the Maze Array
     * @param {({x: number, y: number})} gridPosition - x-y position during the current frame
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     * @returns {({ top: number, left: number})}
     */
    handleUnsnappedMovement(gridPosition, elapsedMs) {
        const desired = this.characterUtil.determineNewPositions(
            this.position, this.desiredDirection, this.velocityPerMs,
            elapsedMs, this.scaledTileSize,
        );
        const alternate = this.characterUtil.determineNewPositions(
            this.position, this.direction, this.velocityPerMs,
            elapsedMs, this.scaledTileSize,
        );

        if (this.characterUtil.turningAround(
            this.direction, this.desiredDirection,
        )) {
            this.direction = this.desiredDirection;
            this.setSpriteSheet(this.direction);
            return desired.newPosition;
        }
        if (this.characterUtil.changingGridPosition(
            gridPosition, alternate.newGridPosition,
        )) {
            return this.characterUtil.snapToGrid(
                gridPosition, this.direction, this.scaledTileSize,
            );
        }
        return alternate.newPosition;
    }

    /**
     * Draws Pacman and his leading arrow, hiding them if there is a stutter,
     * and animates the spritesheet
     * @param {number} interp - The animation accuracy as a percentage
     * @param {Renderer} renderer
     */
    draw(interp, renderer) {
        const updated = this.characterUtil.advanceSpriteSheet(this);
        this.msSinceLastSprite = updated.msSinceLastSprite;
        this.backgroundOffsetPixels = updated.backgroundOffsetPixels;

        this.visible = this.display
            && !this.characterUtil.checkForStutter(
                this.position, this.oldPosition, this.scaledTileSize,
            );

        if (!this.visible) return;

        const top = this.characterUtil.calculateNewDrawValue(
            interp, 'top', this.oldPosition, this.position,
        );
        const left = this.characterUtil.calculateNewDrawValue(
            interp, 'left', this.oldPosition, this.position,
        );

        if (this.arrowSheet) {
            renderer.drawImage(
                this.arrowSheet,
                this.position.left - this.scaledTileSize,
                this.position.top - this.scaledTileSize,
                this.arrowMeasurement, this.arrowMeasurement,
            );
        }

        const frame = this.backgroundOffsetPixels / this.measurement;
        renderer.drawFrame(
            this.sheet, frame, this.spriteFrames, left, top, this.measurement,
        );
    }

    /**
     * Handles movement logic for Pacman
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     */
    update(elapsedMs) {
        this.oldPosition = Object.assign({}, this.position);

        if (this.moving) {
            const gridPosition = this.characterUtil.determineGridPosition(
                this.position, this.scaledTileSize,
            );

            if (this.characterUtil.isSnappedToGrid(
                this.position, gridPosition, this.direction, this.scaledTileSize,
            )) {
                this.position = this.handleSnappedMovement(elapsedMs);
            } else {
                this.position = this.handleUnsnappedMovement(gridPosition, elapsedMs);
            }

            this.position = this.characterUtil.handleWarp(
                this.position, this.scaledTileSize, this.mazeArray,
            );
        }

        if (this.moving || this.specialAnimation) {
            this.msSinceLastSprite += elapsedMs;
        }
    }
}


class GameCoordinator {
    constructor() {
        this.gameUi = document.getElementById('game-ui');
        this.rowTop = document.getElementById('row-top');
        this.mazeDiv = document.getElementById('maze');
        this.canvas = document.getElementById('game-canvas');
        this.pointsDisplay = document.getElementById('points-display');
        this.highScoreDisplay = document.getElementById('high-score-display');
        this.extraLivesDisplay = document.getElementById('extra-lives');
        this.fruitDisplay = document.getElementById('fruit-display');
        this.mainMenu = document.getElementById('main-menu-container');
        this.gameStartButton = document.getElementById('game-start');
        this.pauseButton = document.getElementById('pause-button');
        this.soundButton = document.getElementById('sound-button');
        this.leftCover = document.getElementById('left-cover');
        this.rightCover = document.getElementById('right-cover');
        this.pausedText = document.getElementById('paused-text');
        this.bottomRow = document.getElementById('bottom-row');
        this.movementButtons = document.getElementById('movement-buttons');

        // This is the fixed simulation rate, NOT the render rate - the engine
        // still draws once per animation frame and just drains 1000/maxFps
        // physics steps per frame. Do not lower it: the ghost-house handoff
        // matches on exact positions and windows only 0.2 tiles wide
        // (see enteringGhostHouse / leavingGhostHouse), and at 60 the eyes of
        // an eaten ghost move 0.37 tiles per step and skip straight over them,
        // so they never re-enter the house and the ghost never respawns.
        this.maxFps = 120;
        this.tileSize = 4;
        this.scale = this.determineScale();
        this.scaledTileSize = this.tileSize * this.scale;
        this.firstGame = true;

        this.assets = new AssetStore();
        this.renderer = new Renderer(this.canvas, this.assets);
        this.textOverlays = [];
        this.mazeCoverVisible = false;
        this.mazeTint = null;
        this.pelletBlinkMs = 0;
        this.nearbyPickups = [];

        this.movementKeys = {
            // WASD
            87: 'up',
            83: 'down',
            65: 'left',
            68: 'right',

            // Arrow Keys
            38: 'up',
            40: 'down',
            37: 'left',
            39: 'right',
        };

        this.fruitPoints = {
            1: 100,
            2: 300,
            3: 500,
            4: 700,
            5: 1000,
            6: 2000,
            7: 3000,
            8: 5000,
        };

        this.mazeArray = [
            ['XXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
            ['XooooooooooooXXooooooooooooX'],
            ['XoXXXXoXXXXXoXXoXXXXXoXXXXoX'],
            ['XOXXXXoXXXXXoXXoXXXXXoXXXXOX'],
            ['XoXXXXoXXXXXoXXoXXXXXoXXXXoX'],
            ['XooooooooooooooooooooooooooX'],
            ['XoXXXXoXXoXXXXXXXXoXXoXXXXoX'],
            ['XoXXXXoXXoXXXXXXXXoXXoXXXXoX'],
            ['XooooooXXooooXXooooXXooooooX'],
            ['XXXXXXoXXXXX XX XXXXXoXXXXXX'],
            ['XXXXXXoXXXXX XX XXXXXoXXXXXX'],
            ['XXXXXXoXX          XXoXXXXXX'],
            ['XXXXXXoXX XXXXXXXX XXoXXXXXX'],
            ['XXXXXXoXX X      X XXoXXXXXX'],
            ['      o   X      X   o      '],
            ['XXXXXXoXX X      X XXoXXXXXX'],
            ['XXXXXXoXX XXXXXXXX XXoXXXXXX'],
            ['XXXXXXoXX          XXoXXXXXX'],
            ['XXXXXXoXX XXXXXXXX XXoXXXXXX'],
            ['XXXXXXoXX XXXXXXXX XXoXXXXXX'],
            ['XooooooooooooXXooooooooooooX'],
            ['XoXXXXoXXXXXoXXoXXXXXoXXXXoX'],
            ['XoXXXXoXXXXXoXXoXXXXXoXXXXoX'],
            ['XOooXXooooooo  oooooooXXooOX'],
            ['XXXoXXoXXoXXXXXXXXoXXoXXoXXX'],
            ['XXXoXXoXXoXXXXXXXXoXXoXXoXXX'],
            ['XooooooXXooooXXooooXXooooooX'],
            ['XoXXXXXXXXXXoXXoXXXXXXXXXXoX'],
            ['XoXXXXXXXXXXoXXoXXXXXXXXXXoX'],
            ['XooooooooooooooooooooooooooX'],
            ['XXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
        ];

        this.mazeArray.forEach((row, rowIndex) => {
            this.mazeArray[rowIndex] = row[0].split('');
        });

        this.gameStartButton.addEventListener(
            'click', this.startButtonClick.bind(this),
        );
        this.pauseButton.addEventListener(
            'click', this.handlePauseKey.bind(this),
        );
        this.soundButton.addEventListener(
            'click', this.soundButtonClick.bind(this),
        );



        // Built before preloading so the loading screen can decode every audio
        // clip into its buffer cache.
        this.soundManager = new SoundManager();

        // Stylesheet is bundled by Vite (imported in Game.jsx), so we can begin
        // preloading image/audio assets immediately.
        this.preloadAssets();
    }

    /**
     * Determines the largest scale at which the whole game UI fits on screen.
     *
     * The height budget covers everything stacked in the game column, not just
     * the maze: the score row, the gap below it, the 31-row maze, and the
     * lives/fruit row. Measuring only the maze (as this used to) picks a scale
     * roughly 18% too large, so the score and lives rows get clipped off the
     * top and bottom of the viewport.
     * @returns {Number}
     */
    determineScale() {
        const viewportHeight = Math.min(
            document.documentElement.clientHeight, window.innerHeight || Infinity,
        );
        const viewportWidth = Math.min(
            document.documentElement.clientWidth, window.innerWidth || Infinity,
        );

        // Portrait layouts show the on-screen d-pad below the board.
        const portrait = viewportHeight > viewportWidth;
        const availableHeight = portrait
            ? viewportHeight * (1 - PORTRAIT_CONTROLS_FRACTION)
            : viewportHeight;

        const scaleForWidth = viewportWidth / (MAZE_COLUMNS * this.tileSize);
        const scaleForHeight = availableHeight / (TOTAL_UI_TILES * this.tileSize);

        // Round down to a half step so scaledTileSize stays an even number of
        // pixels, which keeps the tile-fraction offsets (dots sit at 3/8 of a
        // tile) landing on whole pixels.
        const fitted = Math.min(scaleForWidth, scaleForHeight);
        return Math.max(1, Math.floor(fitted * 2) / 2);
    }

    /**
     * Reveals the game underneath the loading covers and starts gameplay
     */
    startButtonClick() {

        this.leftCover.style.left = '-50%';
        this.rightCover.style.right = '-50%';
        this.mainMenu.style.opacity = 0;
        this.gameStartButton.disabled = true;

        setTimeout(() => {
            this.mainMenu.style.visibility = 'hidden';
        }, 1000);

        this.reset();
        if (this.firstGame) {
            this.firstGame = false;
            this.init();
        }
        this.startGameplay(true);

    }

    /**
     * Toggles the master volume for the soundManager, and saves the preference to storage
     */
    soundButtonClick() {
        const newVolume = this.soundManager.masterVolume === 1 ? 0 : 1;
        this.soundManager.setMasterVolume(newVolume);
        localStorage.setItem('volumePreference', newVolume);
        this.setSoundButtonIcon(newVolume);
    }

    /**
     * Sets the icon for the sound button
     */
    setSoundButtonIcon(newVolume) {
        this.soundButton.innerHTML = newVolume === 0
            ? 'volume_off'
            : 'volume_up';
    }

    /**
     * Displays an error message in the event assets are unable to download
     */
    displayErrorMessage() {
        const loadingContainer = document.getElementById('loading-container');
        const errorMessage = document.getElementById('error-message');
        loadingContainer.style.opacity = 0;
        setTimeout(() => {
            loadingContainer.remove();
            errorMessage.style.opacity = 1;
            errorMessage.style.visibility = 'visible';
        }, 1500);
    }

    /**
     * Load all assets into a hidden Div to pre-load them into memory.
     * There is probably a better way to read all of these file names.
     */
    preloadAssets() {
        return new Promise((resolve) => {
            const loadingContainer = document.getElementById('loading-container');
            const loadingPacman = document.getElementById('loading-pacman');
            const loadingDotMask = document.getElementById('loading-dot-mask');

            const imgBase = 'app/style/graphics/spriteSheets/';
            const imgSources = [
                // Pacman
                `${imgBase}characters/pacman/arrow_down.svg`,
                `${imgBase}characters/pacman/arrow_left.svg`,
                `${imgBase}characters/pacman/arrow_right.svg`,
                `${imgBase}characters/pacman/arrow_up.svg`,
                `${imgBase}characters/pacman/pacman_death.svg`,
                `${imgBase}characters/pacman/pacman_error.svg`,
                `${imgBase}characters/pacman/pacman_down.svg`,
                `${imgBase}characters/pacman/pacman_left.svg`,
                `${imgBase}characters/pacman/pacman_right.svg`,
                `${imgBase}characters/pacman/pacman_up.svg`,

                // Blinky
                `${imgBase}characters/ghosts/blinky/blinky_down_angry.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_down_annoyed.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_down.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_left_angry.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_left_annoyed.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_left.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_right_angry.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_right_annoyed.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_right.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_up_angry.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_up_annoyed.svg`,
                `${imgBase}characters/ghosts/blinky/blinky_up.svg`,

                // Clyde
                `${imgBase}characters/ghosts/clyde/clyde_down.svg`,
                `${imgBase}characters/ghosts/clyde/clyde_left.svg`,
                `${imgBase}characters/ghosts/clyde/clyde_right.svg`,
                `${imgBase}characters/ghosts/clyde/clyde_up.svg`,

                // Inky
                `${imgBase}characters/ghosts/inky/inky_down.svg`,
                `${imgBase}characters/ghosts/inky/inky_left.svg`,
                `${imgBase}characters/ghosts/inky/inky_right.svg`,
                `${imgBase}characters/ghosts/inky/inky_up.svg`,

                // Pinky
                `${imgBase}characters/ghosts/pinky/pinky_down.svg`,
                `${imgBase}characters/ghosts/pinky/pinky_left.svg`,
                `${imgBase}characters/ghosts/pinky/pinky_right.svg`,
                `${imgBase}characters/ghosts/pinky/pinky_up.svg`,

                // Ghosts Common
                `${imgBase}characters/ghosts/eyes_down.svg`,
                `${imgBase}characters/ghosts/eyes_left.svg`,
                `${imgBase}characters/ghosts/eyes_right.svg`,
                `${imgBase}characters/ghosts/eyes_up.svg`,
                `${imgBase}characters/ghosts/scared_blue.svg`,
                `${imgBase}characters/ghosts/scared_white.svg`,

                // Dots
                `${imgBase}pickups/pacdot.svg`,
                `${imgBase}pickups/powerPellet.svg`,

                // Fruit
                `${imgBase}pickups/apple.svg`,
                `${imgBase}pickups/bell.svg`,
                `${imgBase}pickups/cherry.svg`,
                `${imgBase}pickups/galaxian.svg`,
                `${imgBase}pickups/key.svg`,
                `${imgBase}pickups/melon.svg`,
                `${imgBase}pickups/orange.svg`,
                `${imgBase}pickups/strawberry.svg`,

                // Text
                `${imgBase}text/ready.svg`,
                `${imgBase}text/game_over.svg`,

                // Points
                `${imgBase}text/100.svg`,
                `${imgBase}text/200.svg`,
                `${imgBase}text/300.svg`,
                `${imgBase}text/400.svg`,
                `${imgBase}text/500.svg`,
                `${imgBase}text/700.svg`,
                `${imgBase}text/800.svg`,
                `${imgBase}text/1000.svg`,
                `${imgBase}text/1600.svg`,
                `${imgBase}text/2000.svg`,
                `${imgBase}text/3000.svg`,
                `${imgBase}text/5000.svg`,

                // Maze
                `${imgBase}maze/maze_blue.svg`,

                // Misc
                'app/style/graphics/extra_life.svg',
            ];

            const audioSources = [
                'game_start',
                'pause',
                'pause_beat',
                'siren_1',
                'siren_2',
                'siren_3',
                'power_up',
                'extra_life',
                'eyes',
                'eat_ghost',
                'death',
                'fruit',
                'dot_1',
                'dot_2',
            ];

            const totalSources = imgSources.length + audioSources.length;
            this.remainingSources = totalSources;

            loadingPacman.style.left = '0';
            loadingDotMask.style.width = '0';

            const containerWidth = loadingContainer.scrollWidth
                - loadingPacman.scrollWidth;

            const onProgress = () => {
                this.remainingSources -= 1;
                const percent = 1 - (this.remainingSources / totalSources);
                loadingPacman.style.left = `${percent * containerWidth}px`;
                loadingDotMask.style.width = loadingPacman.style.left;
            };

            Promise.all([
                // Images go into the AssetStore rather than a hidden div, so the
                // renderer can rasterize them without re-reading the DOM.
                this.assets.load(imgSources, onProgress),
                // Audio is fetched and decoded once, here, so no clip has to be
                // decoded mid-game.
                this.soundManager.load(audioSources, onProgress),
            ]).then(() => {
                loadingContainer.style.opacity = 0;
                resolve();

                setTimeout(() => {
                    loadingContainer.remove();
                    this.mainMenu.style.opacity = 1;
                    this.mainMenu.style.visibility = 'visible';

                    // Show the start screen and wait for the player to click
                    // PLAY — do not auto-start gameplay.
                }, 1500);
            }).catch(this.displayErrorMessage);
        });
    }

    /**
     * Resets gameCoordinator values to their default states
     */
    reset() {
        this.activeTimers = [];
        this.points = 0;
        this.level = 1;
        this.lives = 2;
        this.deathInProgress = false;
        this.extraLifeGiven = false;
        this.remainingDots = 0;
        this.allowKeyPresses = true;
        this.allowPacmanMovement = false;
        this.allowPause = false;
        this.cutscene = true;
        this.highScore = localStorage.getItem('highScore');

        if (this.firstGame) {
            setInterval(() => {
                this.collisionDetectionLoop();
            }, 500);

            this.pacman = new Pacman(
                this.scaledTileSize, this.mazeArray, new CharacterUtil(),
            );
            this.blinky = new Ghost(
                this.scaledTileSize, this.mazeArray, this.pacman, 'blinky',
                this.level, new CharacterUtil(),
            );
            this.pinky = new Ghost(
                this.scaledTileSize, this.mazeArray, this.pacman, 'pinky',
                this.level, new CharacterUtil(),
            );
            this.inky = new Ghost(
                this.scaledTileSize, this.mazeArray, this.pacman, 'inky',
                this.level, new CharacterUtil(), this.blinky,
            );
            this.clyde = new Ghost(
                this.scaledTileSize, this.mazeArray, this.pacman, 'clyde',
                this.level, new CharacterUtil(),
            );
            this.fruit = new Pickup(
                'fruit', this.scaledTileSize, 13.5, 17, this.pacman, 100,
            );
        }

        this.ghosts = [
            this.blinky,
            this.pinky,
            this.inky,
            this.clyde,
        ];

        this.scaredGhosts = [];
        this.eyeGhosts = 0;
        this.textOverlays.length = 0;
        this.mazeCoverVisible = false;
        this.mazeTint = null;

        if (this.firstGame) {
            this.drawMaze(this.mazeArray);
            this.setUiDimensions();
        } else {
            this.pacman.reset();
            this.ghosts.forEach((ghost) => {
                ghost.reset(true);
            });
            this.pickups.forEach((pickup) => {
                if (pickup.type !== 'fruit') {
                    this.remainingDots += 1;
                }
                pickup.reset();
            });
        }

        this.pointsDisplay.innerHTML = '00';
        this.highScoreDisplay.innerHTML = this.highScore || '00';
        this.clearDisplay(this.fruitDisplay);

        const volumePreference = parseInt(
            localStorage.getItem('volumePreference') || 1, 10,
        );
        this.setSoundButtonIcon(volumePreference);
        this.soundManager.setMasterVolume(volumePreference);
    }

    /**
     * Calls necessary setup functions to start the game
     */
    init() {
        this.registerEventListeners();

        this.gameEngine = new GameEngine(
            this.maxFps,
            elapsedMs => this.update(elapsedMs),
            interp => this.render(interp),
        );
        this.gameEngine.start();
    }

    /**
     * Advances the simulation by one fixed timestep. Only the five characters
     * and the handful of pickups currently near Pacman are stepped - the other
     * ~240 dots cannot be collided with, so there is nothing to update.
     * @param {Number} elapsedMs
     */
    update(elapsedMs) {
        this.pelletBlinkMs += elapsedMs;

        this.pacman.update(elapsedMs);
        this.ghosts.forEach((ghost) => {
            ghost.update(elapsedMs);
        });
        this.nearbyPickups.forEach((pickup) => {
            pickup.update();
        });
    }

    /**
     * Builds the list of pickups by iterating through the 2D maze array. Unlike
     * the original DOM implementation these are plain objects - all 244 of them
     * are drawn to the canvas rather than being individual positioned divs.
     * @param {Array} mazeArray - 2D array representing the game board
     */
    drawMaze(mazeArray) {
        this.pickups = [
            this.fruit,
        ];

        mazeArray.forEach((row, rowIndex) => {
            row.forEach((block, columnIndex) => {
                if (block === 'o' || block === 'O') {
                    const type = (block === 'o') ? 'pacdot' : 'powerPellet';
                    const points = (block === 'o') ? 10 : 50;
                    const dot = new Pickup(
                        type, this.scaledTileSize, columnIndex,
                        rowIndex, this.pacman, points,
                    );

                    this.pickups.push(dot);
                    this.remainingDots += 1;
                }
            });
        });
    }

    /**
     * Applies the chosen scale to the UI. Every dimension is expressed in tiles
     * so the column's total height matches what determineScale budgeted for.
     */
    setUiDimensions() {
        const tile = this.scaledTileSize;
        const mazeWidth = tile * MAZE_COLUMNS;
        const mazeHeight = tile * MAZE_ROWS;

        this.gameUi.style.width = `${mazeWidth}px`;
        this.gameUi.style.fontSize = `${tile}px`;

        // Two lines of text at a 1.5 line-height, fixed so a late-loading
        // webfont cannot change the row's height and push the board off screen.
        this.rowTop.style.height = `${tile * SCORE_ROW_TILES}px`;
        this.rowTop.style.lineHeight = `${tile * (SCORE_ROW_TILES / 2)}px`;
        this.rowTop.style.marginBottom = `${tile * SCORE_GAP_TILES}px`;

        this.mazeDiv.style.width = `${mazeWidth}px`;
        this.mazeDiv.style.height = `${mazeHeight}px`;
        this.bottomRow.style.height = `${tile * BOTTOM_ROW_TILES}px`;

        this.renderer.resize(mazeWidth, mazeHeight);
    }

    /**
     * Loop which periodically checks which pickups are nearby Pacman.
     * Pickups which are far away will not be considered for collision detection.
     */
    collisionDetectionLoop() {
        if (this.pacman.position) {
            const maxDistance = (this.pacman.velocityPerMs * 750);
            const pacmanCenter = {
                x: this.pacman.position.left + this.scaledTileSize,
                y: this.pacman.position.top + this.scaledTileSize,
            };

            this.nearbyPickups.length = 0;

            this.pickups.forEach((pickup) => {
                pickup.checkPacmanProximity(maxDistance, pacmanCenter);
                if (pickup.shouldCheckForCollision()) {
                    this.nearbyPickups.push(pickup);
                }
            });
        }
    }

    /**
     * Draws a single frame. Ordering here replaces what CSS z-index used to do:
     * maze, then pickups, then the point/status text, then the characters.
     * @param {Number} interp - The animation accuracy as a percentage
     */
    render(interp) {
        const renderer = this.renderer;
        renderer.clear();

        renderer.drawImage(
            MAZE_IMAGE, 0, 0,
            this.scaledTileSize * MAZE_COLUMNS,
            this.scaledTileSize * MAZE_ROWS,
            this.mazeTint,
        );

        // Power pellets blink on a 300ms cycle, driven off the game clock so
        // they freeze while paused rather than running on their own timeline.
        const pelletsVisible = (this.pelletBlinkMs % 300) >= 150;
        this.pickups.forEach((pickup) => {
            pickup.draw(renderer, pelletsVisible);
        });

        this.textOverlays.forEach((overlay) => {
            renderer.drawImage(
                overlay.image, overlay.left, overlay.top,
                overlay.width, overlay.height,
            );
        });

        this.pacman.draw(interp, renderer);
        this.ghosts.forEach((ghost) => {
            ghost.draw(interp, renderer);
        });

        if (this.mazeCoverVisible) {
            renderer.fillRect(
                0, 0,
                this.scaledTileSize * MAZE_COLUMNS,
                this.scaledTileSize * MAZE_ROWS,
                '#000',
            );
        }
    }

    /**
     * Displays "Ready!" and allows Pacman to move after a breif delay
     * @param {Boolean} initialStart - Special condition for the game's beginning
     */
    startGameplay(initialStart) {
        if (initialStart) {
            this.soundManager.play('game_start');
        }

        this.scaredGhosts = [];
        this.eyeGhosts = 0;
        this.allowPacmanMovement = false;

        const left = this.scaledTileSize * 11;
        const top = this.scaledTileSize * 16.5;
        const duration = initialStart ? 4500 : 2000;
        const width = this.scaledTileSize * 6;
        const height = this.scaledTileSize * 2;

        this.displayText({ left, top }, 'ready', duration, width, height);
        this.updateExtraLivesDisplay();

        new Timer(() => {
            this.allowPause = true;
            this.cutscene = false;
            this.soundManager.setCutscene(this.cutscene);
            this.soundManager.setAmbience(this.determineSiren(this.remainingDots));

            this.allowPacmanMovement = true;
            this.pacman.moving = true;

            this.ghosts.forEach((ghost) => {
                const ghostRef = ghost;
                ghostRef.moving = true;
            });

            this.ghostCycle('scatter');

            this.idleGhosts = [
                this.pinky,
                this.inky,
                this.clyde,
            ];
            this.releaseGhost();
        }, duration);
    }

    /**
     * Clears out all children nodes from a given display element
     * @param {String} display
     */
    clearDisplay(display) {
        while (display.firstChild) {
            display.removeChild(display.firstChild);
        }
    }

    /**
     * Displays extra life images equal to the number of remaining lives
     */
    updateExtraLivesDisplay() {
        this.clearDisplay(this.extraLivesDisplay);

        for (let i = 0; i < this.lives; i += 1) {
            const extraLifePic = document.createElement('img');
            extraLifePic.setAttribute('src', 'app/style/graphics/extra_life.svg');
            extraLifePic.style.height = `${this.scaledTileSize * 2}px`;
            this.extraLivesDisplay.appendChild(extraLifePic);
        }
    }

    /**
     * Displays a rolling log of the seven most-recently eaten fruit
     * @param {String} imageSource
     */
    updateFruitDisplay(imageSource) {
        if (this.fruitDisplay.children.length === 7) {
            this.fruitDisplay.removeChild(this.fruitDisplay.firstChild);
        }

        const fruitPic = document.createElement('img');
        fruitPic.setAttribute('src', imageSource);
        fruitPic.style.height = `${this.scaledTileSize * 2}px`;
        this.fruitDisplay.appendChild(fruitPic);
    }

    /**
     * Cycles the ghosts between 'chase' and 'scatter' mode
     * @param {('chase'|'scatter')} mode
     */
    ghostCycle(mode) {
        const delay = (mode === 'scatter') ? 7000 : 20000;
        const nextMode = (mode === 'scatter') ? 'chase' : 'scatter';

        this.ghostCycleTimer = new Timer(() => {
            this.ghosts.forEach((ghost) => {
                ghost.changeMode(nextMode);
            });

            this.ghostCycle(nextMode);
        }, delay);
    }

    /**
     * Releases a ghost from the Ghost House after a delay
     */
    releaseGhost() {
        if (this.idleGhosts.length > 0) {
            const delay = Math.max((8 - ((this.level - 1) * 4)) * 1000, 0);

            this.endIdleTimer = new Timer(() => {
                this.idleGhosts[0].endIdleMode();
                this.idleGhosts.shift();
            }, delay);
        }
    }

    /**
     * Register listeners for various game sequences
     */
    registerEventListeners() {
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('awardPoints', this.awardPoints.bind(this));
        window.addEventListener('deathSequence', this.deathSequence.bind(this));
        window.addEventListener('dotEaten', this.dotEaten.bind(this));
        window.addEventListener('powerUp', this.powerUp.bind(this));
        window.addEventListener('eatGhost', this.eatGhost.bind(this));
        window.addEventListener('restoreGhost', this.restoreGhost.bind(this));
        window.addEventListener('addTimer', this.addTimer.bind(this));
        window.addEventListener('removeTimer', this.removeTimer.bind(this));
        window.addEventListener('releaseGhost', this.releaseGhost.bind(this));

        const directions = [
            'up', 'down', 'left', 'right',
        ];

        directions.forEach((direction) => {
            preventLongPressMenu(document.getElementById(`button-${direction}`));

            document.getElementById(`button-${direction}`).addEventListener(
                'touchstart', () => {
                    this.changeDirection(direction);
                },
            );
        });
    }

    /**
     * Calls Pacman's changeDirection event if certain conditions are met
     * @param {({'up'|'down'|'left'|'right'})} direction
     */
    changeDirection(direction) {
        if (this.allowKeyPresses && this.gameEngine.running) {
            this.pacman.changeDirection(
                direction, this.allowPacmanMovement,
            );
        }
    }

    /**
     * Calls various class functions depending upon the pressed key
     * @param {Event} e - The keydown event to evaluate
     */
    handleKeyDown(e) {
        if (e.keyCode === 27) {
            // ESC key
            this.handlePauseKey();
        } else if (e.keyCode === 81) {
            // Q
            this.soundButtonClick();
        } else if (this.movementKeys[e.keyCode]) {
            this.changeDirection(this.movementKeys[e.keyCode]);
        }
    }

    /**
     * Handle behavior for the pause key
     */
    handlePauseKey() {
        if (this.allowPause) {
            this.allowPause = false;

            setTimeout(() => {
                if (!this.cutscene) {
                    this.allowPause = true;
                }
            }, 500);

            this.gameEngine.changePausedState(this.gameEngine.running);
            this.soundManager.play('pause');

            if (this.gameEngine.started) {
                this.soundManager.resumeAmbience();
                this.gameUi.style.filter = 'unset';
                this.movementButtons.style.filter = 'unset';
                this.pausedText.style.visibility = 'hidden';
                this.pauseButton.innerHTML = 'pause';
                this.activeTimers.forEach((timer) => {
                    timer.resume();
                });
            } else {
                this.soundManager.stopAmbience();
                this.soundManager.setAmbience('pause_beat', true);
                this.gameUi.style.filter = 'blur(5px)';
                this.movementButtons.style.filter = 'blur(5px)';
                this.pausedText.style.visibility = 'visible';
                this.pauseButton.innerHTML = 'play_arrow';
                this.activeTimers.forEach((timer) => {
                    timer.pause();
                });
            }
        }
    }

    /**
     * Adds points to the player's total
     * @param {({ detail: { points: Number }})} e - Contains a quantity of points to add
     */
    awardPoints(e) {
        this.points += e.detail.points;
        this.pointsDisplay.innerText = this.points;
        if (this.points > (this.highScore || 0)) {
            this.highScore = this.points;
            this.highScoreDisplay.innerText = this.points;
            localStorage.setItem('highScore', this.highScore);
        }

        if (this.points >= 10000 && !this.extraLifeGiven) {
            this.extraLifeGiven = true;
            this.soundManager.play('extra_life');
            this.lives += 1;
            this.updateExtraLivesDisplay();
        }

        if (e.detail.type === 'fruit') {
            const left = e.detail.points >= 1000
                ? this.scaledTileSize * 12.5
                : this.scaledTileSize * 13;
            const top = this.scaledTileSize * 16.5;
            const width = e.detail.points >= 1000
                ? this.scaledTileSize * 3
                : this.scaledTileSize * 2;
            const height = this.scaledTileSize * 2;

            this.displayText({ left, top }, e.detail.points, 2000, width, height);
            this.soundManager.play('fruit');
            this.updateFruitDisplay(this.fruit.determineImage(
                'fruit', e.detail.points,
            ));
        }
    }

    /**
     * Animates Pacman's death, subtracts a life, and resets character positions if
     * the player has remaining lives.
     */
    deathSequence() {
        // Ghost collisions are checked every frame, so an overlapping ghost can
        // dispatch this event many times during the death animation. Without
        // this guard each repeat would subtract another life, draining several
        // lives (and skipping to game-over) from a single death.
        if (this.deathInProgress) {
            return;
        }
        this.deathInProgress = true;

        this.allowPause = false;
        this.cutscene = true;
        this.soundManager.setCutscene(this.cutscene);
        this.soundManager.stopAmbience();
        this.removeTimer({ detail: { timer: this.fruitTimer } });
        this.removeTimer({ detail: { timer: this.ghostCycleTimer } });
        this.removeTimer({ detail: { timer: this.endIdleTimer } });
        this.removeTimer({ detail: { timer: this.ghostFlashTimer } });

        this.allowKeyPresses = false;
        this.pacman.moving = false;
        this.ghosts.forEach((ghost) => {
            const ghostRef = ghost;
            ghostRef.moving = false;
        });

        new Timer(() => {
            this.ghosts.forEach((ghost) => {
                const ghostRef = ghost;
                ghostRef.display = false;
            });
            this.pacman.prepDeathAnimation();
            this.soundManager.play('death');


            if (this.lives > 0) {
                this.lives -= 1;

                new Timer(() => {
                    this.mazeCoverVisible = true;
                    new Timer(() => {
                        this.allowKeyPresses = true;
                        this.mazeCoverVisible = false;
                        this.pacman.reset();
                        this.ghosts.forEach((ghost) => {
                            ghost.reset();
                        });
                        this.fruit.hideFruit();

                        this.deathInProgress = false;
                        this.startGameplay();
                    }, 500);
                }, 2250);
            } else {
                this.gameOver();
            }
        }, 750);
    }

    /**
     * Displays GAME OVER text and displays the menu so players can play again
     */
    gameOver() {
        localStorage.setItem('highScore', this.highScore);

        // Let the React layer know the run ended and with what score, so it can
        // offer a name entry when the player earns a spot on the leaderboard.
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: { score: this.points },
        }));

        new Timer(() => {
            this.displayText(
                {
                    left: this.scaledTileSize * 9,
                    top: this.scaledTileSize * 16.5,
                },
                'game_over', 4000,
                this.scaledTileSize * 10,
                this.scaledTileSize * 2,
            );
            this.fruit.hideFruit();

            new Timer(() => {
                this.leftCover.style.left = '0';
                this.rightCover.style.right = '0';

                setTimeout(() => {
                    this.mainMenu.style.opacity = 1;
                    this.gameStartButton.disabled = false;
                    this.mainMenu.style.visibility = 'visible';
                }, 1000);
            }, 2500);
        }, 2250);
    }

    /**
     * Handle events related to the number of remaining dots
     */
    dotEaten() {
        this.remainingDots -= 1;

        this.soundManager.playDotSound();

        if (this.remainingDots === 174 || this.remainingDots === 74) {
            this.createFruit();
        }

        if (this.remainingDots === 40 || this.remainingDots === 20) {
            this.speedUpBlinky();
        }

        if (this.remainingDots === 0) {
            this.advanceLevel();
        }
    }

    /**
     * Creates a bonus fruit for ten seconds
     */
    createFruit() {
        this.removeTimer({ detail: { timer: this.fruitTimer } });
        this.fruit.showFruit(this.fruitPoints[this.level] || 5000);
        this.fruitTimer = new Timer(() => {
            this.fruit.hideFruit();
        }, 10000);
    }

    /**
     * Speeds up Blinky and raises the background noise pitch
     */
    speedUpBlinky() {
        this.blinky.speedUp();

        if (this.scaredGhosts.length === 0 && this.eyeGhosts === 0) {
            this.soundManager.setAmbience(this.determineSiren(this.remainingDots));
        }
    }

    /**
     * Determines the correct siren ambience
     * @param {Number} remainingDots
     * @returns {String}
     */
    determineSiren(remainingDots) {
        let sirenNum;

        if (remainingDots > 40) {
            sirenNum = 1;
        } else if (remainingDots > 20) {
            sirenNum = 2;
        } else {
            sirenNum = 3;
        }

        return `siren_${sirenNum}`;
    }

    /**
     * Resets the gameboard and prepares the next level
     */
    advanceLevel() {
        this.allowPause = false;
        this.cutscene = true;
        this.soundManager.setCutscene(this.cutscene);
        this.allowKeyPresses = false;
        this.soundManager.stopAmbience();
        this.pacman.moving = false;
        this.ghosts.forEach((ghost) => {
            const ghostRef = ghost;
            ghostRef.moving = false;
        });

        this.removeTimer({ detail: { timer: this.fruitTimer } });
        this.removeTimer({ detail: { timer: this.ghostCycleTimer } });
        this.removeTimer({ detail: { timer: this.endIdleTimer } });
        this.removeTimer({ detail: { timer: this.ghostFlashTimer } });

        new Timer(() => {
            this.ghosts.forEach((ghost) => {
                const ghostRef = ghost;
                ghostRef.display = false;
            });

            this.mazeTint = MAZE_FLASH_TINT;
            new Timer(() => {
                this.mazeTint = null;
                new Timer(() => {
                    this.mazeTint = MAZE_FLASH_TINT;
                    new Timer(() => {
                        this.mazeTint = null;
                        new Timer(() => {
                            this.mazeTint = MAZE_FLASH_TINT;
                            new Timer(() => {
                                this.mazeTint = null;
                                new Timer(() => {
                                    this.mazeCoverVisible = true;
                                    new Timer(() => {
                                        this.mazeCoverVisible = false;
                                        this.level += 1;
                                        this.allowKeyPresses = true;
                                        this.resetBoardForNextLevel();
                                        this.startGameplay();
                                    }, 500);
                                }, 250);
                            }, 250);
                        }, 250);
                    }, 250);
                }, 250);
            }, 250);
        }, 2000);
    }

    /**
     * Restores every character and pickup to its starting state for a new level
     */
    resetBoardForNextLevel() {
        this.pacman.reset();

        this.ghosts.forEach((ghost) => {
            const ghostRef = ghost;
            ghostRef.level = this.level;
            ghostRef.reset();
            ghostRef.resetDefaultSpeed();
        });

        this.pickups.forEach((pickup) => {
            pickup.reset();
            if (pickup.type !== 'fruit') {
                this.remainingDots += 1;
            }
        });
    }

    /**
     * Flashes ghosts blue and white to indicate the end of the powerup
     * @param {Number} flashes - Total number of elapsed flashes
     * @param {Number} maxFlashes - Total flashes to show
     */
    flashGhosts(flashes, maxFlashes) {
        if (flashes === maxFlashes) {
            this.scaredGhosts.forEach((ghost) => {
                ghost.endScared();
            });
            this.scaredGhosts = [];
            if (this.eyeGhosts === 0) {
                this.soundManager.setAmbience(this.determineSiren(this.remainingDots));
            }
        } else if (this.scaredGhosts.length > 0) {
            this.scaredGhosts.forEach((ghost) => {
                ghost.toggleScaredColor();
            });

            this.ghostFlashTimer = new Timer(() => {
                this.flashGhosts(flashes + 1, maxFlashes);
            }, 250);
        }
    }

    /**
     * Upon eating a power pellet, sets the ghosts to 'scared' mode
     */
    powerUp() {
        if (this.remainingDots !== 0) {
            this.soundManager.setAmbience('power_up');
        }

        this.removeTimer({ detail: { timer: this.ghostFlashTimer } });

        this.ghostCombo = 0;
        this.scaredGhosts = [];

        this.ghosts.forEach((ghost) => {
            if (ghost.mode !== 'eyes') {
                this.scaredGhosts.push(ghost);
            }
        });

        this.scaredGhosts.forEach((ghost) => {
            ghost.becomeScared();
        });

        const powerDuration = Math.max((7 - this.level) * 1000, 0);
        this.ghostFlashTimer = new Timer(() => {
            this.flashGhosts(0, 9);
        }, powerDuration);
    }

    /**
     * Determines the quantity of points to give based on the current combo
     */
    determineComboPoints() {
        return (100 * (2 ** this.ghostCombo));
    }

    /**
     * Upon eating a ghost, award points and temporarily pause movement
     * @param {CustomEvent} e - Contains a target ghost object
     */
    eatGhost(e) {
        const pauseDuration = 1000;
        const { position, measurement } = e.detail.ghost;

        this.pauseTimer({ detail: { timer: this.ghostFlashTimer } });
        this.pauseTimer({ detail: { timer: this.ghostCycleTimer } });
        this.pauseTimer({ detail: { timer: this.fruitTimer } });
        this.soundManager.play('eat_ghost');

        this.scaredGhosts = this.scaredGhosts.filter(
            ghost => ghost.name !== e.detail.ghost.name,
        );
        this.eyeGhosts += 1;

        this.ghostCombo += 1;
        const comboPoints = this.determineComboPoints();
        window.dispatchEvent(new CustomEvent('awardPoints', {
            detail: {
                points: comboPoints,
            },
        }));
        this.displayText(
            position, comboPoints, pauseDuration, measurement,
        );

        this.allowPacmanMovement = false;
        this.pacman.display = false;
        this.pacman.moving = false;
        e.detail.ghost.display = false;
        e.detail.ghost.moving = false;

        this.ghosts.forEach((ghost) => {
            const ghostRef = ghost;
            ghostRef.animate = false;
            ghostRef.pause(true);
            ghostRef.allowCollision = false;
        });

        new Timer(() => {
            this.soundManager.setAmbience('eyes');

            this.resumeTimer({ detail: { timer: this.ghostFlashTimer } });
            this.resumeTimer({ detail: { timer: this.ghostCycleTimer } });
            this.resumeTimer({ detail: { timer: this.fruitTimer } });
            this.allowPacmanMovement = true;
            this.pacman.display = true;
            this.pacman.moving = true;
            e.detail.ghost.display = true;
            e.detail.ghost.moving = true;
            this.ghosts.forEach((ghost) => {
                const ghostRef = ghost;
                ghostRef.animate = true;
                ghostRef.pause(false);
                ghostRef.allowCollision = true;
            });
        }, pauseDuration);
    }

    /**
     * Decrements the count of "eye" ghosts and updates the ambience
     */
    restoreGhost() {
        this.eyeGhosts -= 1;

        if (this.eyeGhosts === 0) {
            const sound = this.scaredGhosts.length > 0
                ? 'power_up' : this.determineSiren(this.remainingDots);
            this.soundManager.setAmbience(sound);
        }
    }

    /**
     * Creates a temporary div to display points on screen
     * @param {({ left: number, top: number })} position - CSS coordinates to display the points at
     * @param {Number} amount - Amount of points to display
     * @param {Number} duration - Milliseconds to display the points before disappearing
     * @param {Number} width - Image width in pixels
     * @param {Number} height - Image height in pixels
     */
    displayText(position, amount, duration, width, height) {
        const overlay = {
            image: `app/style/graphics/spriteSheets/text/${amount}.svg`,
            left: position.left,
            top: position.top,
            width,
            height: height || width,
        };

        this.textOverlays.push(overlay);

        new Timer(() => {
            const index = this.textOverlays.indexOf(overlay);
            if (index !== -1) {
                this.textOverlays.splice(index, 1);
            }
        }, duration);
    }

    /**
     * Pushes a Timer to the activeTimers array
     * @param {({ detail: { timer: Object }})} e
     */
    addTimer(e) {
        this.activeTimers.push(e.detail.timer);
    }

    /**
     * Checks if a Timer with a matching ID exists
     * @param {({ detail: { timer: Object }})} e
     * @returns {Boolean}
     */
    timerExists(e) {
        return !!(e.detail.timer || {}).timerId;
    }

    /**
     * Pauses a timer
     * @param {({ detail: { timer: Object }})} e
     */
    pauseTimer(e) {
        if (this.timerExists(e)) {
            e.detail.timer.pause(true);
        }
    }

    /**
     * Resumes a timer
     * @param {({ detail: { timer: Object }})} e
     */
    resumeTimer(e) {
        if (this.timerExists(e)) {
            e.detail.timer.resume(true);
        }
    }

    /**
     * Removes a Timer from activeTimers
     * @param {({ detail: { timer: Object }})} e
     */
    removeTimer(e) {
        if (this.timerExists(e)) {
            window.clearTimeout(e.detail.timer.timerId);
            this.activeTimers = this.activeTimers.filter(
                timer => timer.timerId !== e.detail.timer.timerId,
            );
        }
    }
}


class GameEngine {
    constructor(maxFps, update, render) {
        this.fpsDisplay = document.getElementById('fps-display');
        this.displayedFps = null;
        this.elapsedMs = 0;
        this.lastFrameTimeMs = 0;
        this.update = update;
        this.render = render;
        this.maxFps = maxFps;
        this.timestep = 1000 / this.maxFps;
        this.fps = this.maxFps;
        this.framesThisSecond = 0;
        this.lastFpsUpdate = 0;
        this.frameId = 0;
        this.running = false;
        this.started = false;
    }

    /**
     * Toggles the paused/running status of the game
     * @param {Boolean} running - Whether the game is currently in motion
     */
    changePausedState(running) {
        if (running) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * Updates the on-screen FPS counter once per second
     * @param {number} timestamp - The amount of MS which has passed since starting the game engine
     */
    updateFpsDisplay(timestamp) {
        this.framesThisSecond += 1;

        if (timestamp > this.lastFpsUpdate + 1000) {
            this.fps = (this.framesThisSecond + this.fps) / 2;
            this.lastFpsUpdate = timestamp;
            this.framesThisSecond = 0;

            // Only touch the DOM when the number actually changes - this used to
            // rewrite the text node on every single frame.
            const rounded = Math.round(this.fps);
            if (rounded !== this.displayedFps) {
                this.displayedFps = rounded;
                this.fpsDisplay.textContent = `${rounded} FPS`;
            }
        }
    }

    /**
     * In the event that a ton of unsimulated frames pile up, discard all of these frames
     * to prevent crashing the game
     */
    panic() {
        this.elapsedMs = 0;
    }

    /**
     * Draws an initial frame, resets a few tracking variables related to animation, and calls
     * the mainLoop function to start the engine
     */
    start() {
        if (!this.started) {
            this.started = true;

            this.frameId = requestAnimationFrame((firstTimestamp) => {
                this.render(1);
                this.running = true;
                this.lastFrameTimeMs = firstTimestamp;
                this.lastFpsUpdate = firstTimestamp;
                this.framesThisSecond = 0;

                this.frameId = requestAnimationFrame((timestamp) => {
                    this.mainLoop(timestamp);
                });
            });
        }
    }

    /**
     * Stops the engine and cancels the current animation frame
     */
    stop() {
        this.running = false;
        this.started = false;
        cancelAnimationFrame(this.frameId);
    }

    /**
     * The loop which will process all necessary frames to update the game's entities
     * prior to animating them
     */
    processFrames() {
        let numUpdateSteps = 0;
        while (this.elapsedMs >= this.timestep) {
            this.update(this.timestep);
            this.elapsedMs -= this.timestep;
            numUpdateSteps += 1;
            if (numUpdateSteps >= this.maxFps) {
                this.panic();
                break;
            }
        }
    }

    /**
     * A single cycle of the engine which checks to see if enough time has passed, and, if so,
     * will kick off the loops to update and draw the game's entities.
     * @param {number} timestamp - The amount of MS which has passed since starting the game engine
     */
    engineCycle(timestamp) {
        if (timestamp < this.lastFrameTimeMs + (1000 / this.maxFps)) {
            this.frameId = requestAnimationFrame((nextTimestamp) => {
                this.mainLoop(nextTimestamp);
            });
            return;
        }

        this.elapsedMs += timestamp - this.lastFrameTimeMs;
        this.lastFrameTimeMs = timestamp;
        this.updateFpsDisplay(timestamp);
        this.processFrames();
        this.render(this.elapsedMs / this.timestep);

        this.frameId = requestAnimationFrame((nextTimestamp) => {
            this.mainLoop(nextTimestamp);
        });
    }

    /**
     * The endless loop which will kick off engine cycles so long as the game is running
     * @param {number} timestamp - The amount of MS which has passed since starting the game engine
     */
    mainLoop(timestamp) {
        this.engineCycle(timestamp);
    }
}


class Pickup {
    constructor(type, scaledTileSize, column, row, pacman, points) {
        this.type = type;
        this.pacman = pacman;
        this.points = points;
        this.nearPacman = false;
        this.visible = true;

        this.fruitImages = {
            100: 'cherry',
            300: 'strawberry',
            500: 'orange',
            700: 'apple',
            1000: 'melon',
            2000: 'galaxian',
            3000: 'bell',
            5000: 'key',
        };

        this.setStyleMeasurements(type, scaledTileSize, column, row, points);
    }

    /**
     * Resets the pickup's visibility
     */
    reset() {
        this.visible = (this.type !== 'fruit');
    }

    /**
     * Sets the pickup's size and position depending on its type
     * @param {('pacdot'|'powerPellet'|'fruit')} type - The classification of pickup
     * @param {number} scaledTileSize
     * @param {number} column
     * @param {number} row
     * @param {number} points
     */
    setStyleMeasurements(type, scaledTileSize, column, row, points) {
        if (type === 'pacdot') {
            this.size = scaledTileSize * 0.25;
            this.x = (column * scaledTileSize) + ((scaledTileSize / 8) * 3);
            this.y = (row * scaledTileSize) + ((scaledTileSize / 8) * 3);
        } else if (type === 'powerPellet') {
            this.size = scaledTileSize;
            this.x = (column * scaledTileSize);
            this.y = (row * scaledTileSize);
        } else {
            this.size = scaledTileSize * 2;
            this.x = (column * scaledTileSize) - (scaledTileSize * 0.5);
            this.y = (row * scaledTileSize) - (scaledTileSize * 0.5);
        }

        this.center = {
            x: column * scaledTileSize,
            y: row * scaledTileSize,
        };

        this.image = this.determineImage(type, points);

        this.reset();
    }

    /**
     * Determines the Pickup image path based on type and point value
     * @param {('pacdot'|'powerPellet'|'fruit')} type - The classification of pickup
     * @param {Number} points
     * @returns {String}
     */
    determineImage(type, points) {
        let image = '';

        if (type === 'fruit') {
            image = this.fruitImages[points] || 'cherry';
        } else {
            image = type;
        }

        return `app/style/graphics/spriteSheets/pickups/${image}.svg`;
    }

    /**
     * Draws the pickup if it has not been eaten. Power pellets blink, which the
     * caller drives with a shared clock so every pellet flashes in unison.
     * @param {Renderer} renderer
     * @param {Boolean} pelletsVisible - Current phase of the power-pellet blink
     */
    draw(renderer, pelletsVisible) {
        if (!this.visible) return;
        if (this.type === 'powerPellet' && !pelletsVisible) return;

        renderer.drawImage(this.image, this.x, this.y, this.size, this.size);
    }

    /**
     * Shows a bonus fruit, resetting its point value and image
     * @param {number} points
     */
    showFruit(points) {
        this.points = points;
        this.image = this.determineImage(this.type, points);
        this.visible = true;
    }

    /**
     * Makes the fruit invisible (happens if Pacman was too slow)
     */
    hideFruit() {
        this.visible = false;
    }

    /**
     * Returns true if the Pickup is touching a bounding box at Pacman's center
     * @param {({ x: number, y: number, size: number})} pickup
     * @param {({ x: number, y: number, size: number})} originalPacman
     */
    checkForCollision(pickup, originalPacman) {
        const pacman = Object.assign({}, originalPacman);

        pacman.x += (pacman.size * 0.25);
        pacman.y += (pacman.size * 0.25);
        pacman.size /= 2;

        return (pickup.x < pacman.x + pacman.size
            && pickup.x + pickup.size > pacman.x
            && pickup.y < pacman.y + pacman.size
            && pickup.y + pickup.size > pacman.y);
    }

    /**
     * Checks to see if the pickup is close enough to Pacman to be considered for collision detection
     * @param {number} maxDistance - The maximum distance Pacman can travel per cycle
     * @param {({ x:number, y:number })} pacmanCenter - The center of Pacman's hitbox
     * @param {Boolean} debugging - Flag to change the appearance of pickups for testing
     */
    checkPacmanProximity(maxDistance, pacmanCenter) {
        if (this.visible) {
            const distance = Math.sqrt(
                ((this.center.x - pacmanCenter.x) ** 2)
                + ((this.center.y - pacmanCenter.y) ** 2),
            );

            this.nearPacman = (distance <= maxDistance);
        }
    }

    /**
     * Checks if the pickup is visible and close to Pacman
     * @returns {Boolean}
     */
    shouldCheckForCollision() {
        return this.visible && this.nearPacman;
    }

    /**
     * If the Pickup is still visible, it checks to see if it is colliding with Pacman.
     * It will turn itself invisible and cease collision-detection after the first
     * collision with Pacman.
     */
    update() {
        if (this.shouldCheckForCollision()) {
            if (this.checkForCollision(
                {
                    x: this.x,
                    y: this.y,
                    size: this.size,
                }, {
                x: this.pacman.position.left,
                y: this.pacman.position.top,
                size: this.pacman.measurement,
            },
            )) {
                this.visible = false;
                window.dispatchEvent(new CustomEvent('awardPoints', {
                    detail: {
                        points: this.points,
                        type: this.type,
                    },
                }));

                if (this.type === 'pacdot') {
                    window.dispatchEvent(new Event('dotEaten'));
                } else if (this.type === 'powerPellet') {
                    window.dispatchEvent(new Event('dotEaten'));
                    window.dispatchEvent(new Event('powerUp'));
                }
            }
        }
    }
}


class CharacterUtil {
    constructor() {
        this.directions = {
            up: 'up',
            down: 'down',
            left: 'left',
            right: 'right',
        };
    }

    /**
     * Check if a given character has moved more than five in-game tiles during a frame.
     * If so, we want to temporarily hide the object to avoid 'animation stutter'.
     * @param {({top: number, left: number})} position - Position during the current frame
     * @param {({top: number, left: number})} oldPosition - Position during the previous frame
     * @returns {('hidden'|'visible')} - The new 'visibility' css property value for the character.
     */
    checkForStutter(position, oldPosition, scaledTileSize) {
        // This exists to hide a character for the single frame it teleports
        // through a tunnel, which moves it ~28 tiles sideways. The threshold is
        // measured in tiles rather than a fixed pixel count because legitimate
        // movement per step scales with both the tile size and the timestep:
        // the fastest thing in the game (a ghost's eyes returning home) covers
        // about 0.37 tiles per step, so one tile separates the two cleanly.
        const threshold = scaledTileSize;

        if (position && oldPosition) {
            return (
                Math.abs(position.top - oldPosition.top) > threshold
                || Math.abs(position.left - oldPosition.left) > threshold
            );
        }

        return false;
    }

    /**
     * Checks whether a character is exactly aligned to the maze grid. Compares
     * the numbers directly rather than serializing both positions, since this
     * runs for every character on every update step.
     * @param {({top: number, left: number})} position - Position during the current frame
     * @param {({x: number, y: number})} gridPosition - x-y position on the 2D Maze Array
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @returns {boolean}
     */
    isSnappedToGrid(position, gridPosition, direction, scaledTileSize) {
        const snapped = this.snapToGrid(
            gridPosition, direction, scaledTileSize,
        );

        return position.top === snapped.top && position.left === snapped.left;
    }

    /**
     * Check which CSS property needs to be changed given the character's current direction
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @returns {('top'|'left')}
     */
    getPropertyToChange(direction) {
        switch (direction) {
            case this.directions.up:
            case this.directions.down:
                return 'top';
            default:
                return 'left';
        }
    }

    /**
     * Calculate the velocity for the character's next frame.
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {number} velocityPerMs - The distance to travel in a single millisecond
     * @returns {number} - Moving down or right is positive, while up or left is negative.
     */
    getVelocity(direction, velocityPerMs) {
        switch (direction) {
            case this.directions.up:
            case this.directions.left:
                return velocityPerMs * -1;
            default:
                return velocityPerMs;
        }
    }

    /**
     * Determine the next value which will be used to draw the character's position on screen
     * @param {number} interp - The percentage of the desired timestamp between frames
     * @param {('top'|'left')} prop - The css property to be changed
     * @param {({top: number, left: number})} oldPosition - Position during the previous frame
     * @param {({top: number, left: number})} position - Position during the current frame
     * @returns {number} - New value for css positioning
     */
    calculateNewDrawValue(interp, prop, oldPosition, position) {
        return oldPosition[prop] + (position[prop] - oldPosition[prop]) * interp;
    }

    /**
     * Convert the character's css position to a row-column on the maze array
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @returns {({x: number, y: number})}
     */
    determineGridPosition(position, scaledTileSize) {
        return {
            x: (position.left / scaledTileSize) + 0.5,
            y: (position.top / scaledTileSize) + 0.5,
        };
    }

    /**
     * Check to see if a character's disired direction results in turning around
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {('up'|'down'|'left'|'right')} desiredDirection - Character's desired orientation
     * @returns {boolean}
     */
    turningAround(direction, desiredDirection) {
        return desiredDirection === this.getOppositeDirection(direction);
    }

    /**
     * Calculate the opposite of a given direction
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @returns {('up'|'down'|'left'|'right')}
     */
    getOppositeDirection(direction) {
        switch (direction) {
            case this.directions.up:
                return this.directions.down;
            case this.directions.down:
                return this.directions.up;
            case this.directions.left:
                return this.directions.right;
            default:
                return this.directions.left;
        }
    }

    /**
     * Calculate the proper rounding function to assist with collision detection
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @returns {Function}
     */
    determineRoundingFunction(direction) {
        switch (direction) {
            case this.directions.up:
            case this.directions.left:
                return Math.floor;
            default:
                return Math.ceil;
        }
    }

    /**
     * Check to see if the character's next frame results in moving to a new tile on the maze array
     * @param {({x: number, y: number})} oldPosition - Position during the previous frame
     * @param {({x: number, y: number})} position - Position during the current frame
     * @returns {boolean}
     */
    changingGridPosition(oldPosition, position) {
        return (
            Math.floor(oldPosition.x) !== Math.floor(position.x)
            || Math.floor(oldPosition.y) !== Math.floor(position.y)
        );
    }

    /**
     * Check to see if the character is attempting to run into a wall of the maze
     * @param {({x: number, y: number})} desiredNewGridPosition - Character's target tile
     * @param {Array} mazeArray - The 2D array representing the game's maze
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @returns {boolean}
     */
    checkForWallCollision(desiredNewGridPosition, mazeArray, direction) {
        const roundingFunction = this.determineRoundingFunction(
            direction, this.directions,
        );

        const desiredX = roundingFunction(desiredNewGridPosition.x);
        const desiredY = roundingFunction(desiredNewGridPosition.y);
        let newGridValue;

        if (Array.isArray(mazeArray[desiredY])) {
            newGridValue = mazeArray[desiredY][desiredX];
        }

        return (newGridValue === 'X');
    }

    /**
     * Returns an object containing the new position and grid position based upon a direction
     * @param {({top: number, left: number})} position - css position during the current frame
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {number} velocityPerMs - The distance to travel in a single millisecond
     * @param {number} elapsedMs - The amount of MS that have passed since the last update
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @returns {object}
     */
    determineNewPositions(
        position, direction, velocityPerMs, elapsedMs, scaledTileSize,
    ) {
        const newPosition = Object.assign({}, position);
        newPosition[this.getPropertyToChange(direction)]
            += this.getVelocity(direction, velocityPerMs) * elapsedMs;
        const newGridPosition = this.determineGridPosition(
            newPosition, scaledTileSize,
        );

        return {
            newPosition,
            newGridPosition,
        };
    }

    /**
     * Calculates the css position when snapping the character to the x-y grid
     * @param {({x: number, y: number})} position - The character's position during the current frame
     * @param {('up'|'down'|'left'|'right')} direction - The character's current travel orientation
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @returns {({top: number, left: number})}
     */
    snapToGrid(position, direction, scaledTileSize) {
        const newPosition = Object.assign({}, position);
        const roundingFunction = this.determineRoundingFunction(
            direction, this.directions,
        );

        switch (direction) {
            case this.directions.up:
            case this.directions.down:
                newPosition.y = roundingFunction(newPosition.y);
                break;
            default:
                newPosition.x = roundingFunction(newPosition.x);
                break;
        }

        return {
            top: (newPosition.y - 0.5) * scaledTileSize,
            left: (newPosition.x - 0.5) * scaledTileSize,
        };
    }

    /**
     * Returns a modified position if the character needs to warp
     * @param {({top: number, left: number})} position - css position during the current frame
     * @param {({x: number, y: number})} gridPosition - x-y position during the current frame
     * @param {number} scaledTileSize - The dimensions of a single tile
     * @returns {({top: number, left: number})}
     */
    handleWarp(position, scaledTileSize, mazeArray) {
        const newPosition = Object.assign({}, position);
        const gridPosition = this.determineGridPosition(position, scaledTileSize);

        if (gridPosition.x < -0.75) {
            newPosition.left = (scaledTileSize * (mazeArray[0].length - 0.75));
        } else if (gridPosition.x > (mazeArray[0].length - 0.25)) {
            newPosition.left = (scaledTileSize * -1.25);
        }

        return newPosition;
    }

    /**
     * Advances spritesheet by one frame if needed
     * @param {Object} character - The character which needs to be animated
     */
    advanceSpriteSheet(character) {
        const { msSinceLastSprite, backgroundOffsetPixels } = character;
        const updatedProperties = {
            msSinceLastSprite,
            backgroundOffsetPixels,
        };

        const ready = (character.msSinceLastSprite > character.msBetweenSprites)
            && character.animate;
        if (ready) {
            updatedProperties.msSinceLastSprite = 0;

            if (character.backgroundOffsetPixels
                < (character.measurement * (character.spriteFrames - 1))
            ) {
                updatedProperties.backgroundOffsetPixels += character.measurement;
            } else if (character.loopAnimation) {
                updatedProperties.backgroundOffsetPixels = 0;
            }
        }

        return updatedProperties;
    }
}


class SoundManager {
    constructor() {
        this.baseUrl = 'app/style/audio/';
        this.fileFormat = 'mp3';
        this.masterVolume = 1;
        this.paused = false;
        this.cutscene = true;
        this.dotSound = 1;
        this.dotPlaying = false;
        this.queuedDotSound = false;
        this.buffers = new Map();

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.context = new AudioContextClass();

        this.gainNode = this.context.createGain();
        this.gainNode.connect(this.context.destination);

        // Browsers block audio until the user interacts with the page, and this
        // game auto-starts without a click. Resume the AudioContext on the
        // first gesture so sound works from then on.
        const unlock = () => {
            if (this.context.state === 'suspended') {
                this.context.resume();
            }
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('keydown', unlock);
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('touchstart', unlock);
    }

    /**
     * Fetches and decodes every clip up front, so nothing decodes during play.
     * @param {String[]} sounds - Clip names, without directory or extension
     * @param {Function} [onProgress] - Called once per decoded clip
     * @returns {Promise<void>}
     */
    load(sounds, onProgress) {
        return Promise.all(sounds.map(sound => fetch(
            `${this.baseUrl}${sound}.${this.fileFormat}`,
        )
            .then(response => response.arrayBuffer())
            .then(data => this.context.decodeAudioData(data))
            .then((buffer) => {
                this.buffers.set(sound, buffer);
            })
            .catch(() => {
                // A missing or undecodable clip should not block the game.
            })
            .then(() => {
                if (onProgress) onProgress();
            }))).then(() => undefined);
    }

    /**
     * Sets the cutscene flag to determine if players should be able to resume ambience
     * @param {Boolean} newValue
     */
    setCutscene(newValue) {
        this.cutscene = newValue;
    }

    /**
     * Sets the master volume for all sounds and stops/resumes ambience
     * @param {(0|1)} newVolume
     */
    setMasterVolume(newVolume) {
        this.masterVolume = newVolume;
        this.gainNode.gain.value = newVolume;

        if (this.masterVolume === 0) {
            this.stopAmbience();
        } else {
            this.resumeAmbience(this.paused);
        }
    }

    /**
     * Starts a one-shot BufferSource for a cached clip
     * @param {String} sound
     * @returns {(AudioBufferSourceNode|null)}
     */
    createSource(sound) {
        const buffer = this.buffers.get(sound);

        if (!buffer || this.masterVolume === 0) {
            return null;
        }

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        return source;
    }

    /**
     * Plays a single sound effect
     * @param {String} sound
     */
    play(sound) {
        const source = this.createSource(sound);

        if (source) {
            source.start();
        }
    }

    /**
     * Special method for eating dots. The dots should alternate between two
     * sound effects, but not too quickly.
     */
    playDotSound() {
        this.queuedDotSound = true;

        if (this.dotPlaying) {
            return;
        }

        this.queuedDotSound = false;
        this.dotSound = (this.dotSound === 1) ? 2 : 1;

        const source = this.createSource(`dot_${this.dotSound}`);
        if (!source) {
            return;
        }

        this.dotPlaying = true;
        source.onended = () => {
            this.dotPlaying = false;

            if (this.queuedDotSound) {
                this.playDotSound();
            }
        };
        source.start();
    }

    /**
     * Loops an ambient sound
     * @param {String} sound
     * @param {Boolean} [keepCurrentAmbience] - Retain the track to resume later
     */
    setAmbience(sound, keepCurrentAmbience) {
        if (this.cutscene) {
            return;
        }

        if (keepCurrentAmbience) {
            this.paused = true;
        } else {
            this.currentAmbience = sound;
            this.paused = false;
        }

        this.stopAmbience();

        const source = this.createSource(sound);
        if (!source) {
            return;
        }

        source.loop = true;
        source.start();
        this.ambienceSource = source;
    }

    /**
     * Resumes the ambience
     * @param {Boolean} paused
     */
    resumeAmbience(paused) {
        if (this.currentAmbience) {
            // An AudioBufferSourceNode can only be started once, so resuming
            // means building a fresh source from the same cached buffer.
            if (paused) {
                this.setAmbience('pause_beat', true);
            } else {
                this.setAmbience(this.currentAmbience);
            }
        }
    }

    /**
     * Stops the ambience
     */
    stopAmbience() {
        if (this.ambienceSource) {
            this.ambienceSource.stop();
            this.ambienceSource.disconnect();
            this.ambienceSource = null;
        }
    }
}


class Timer {
    constructor(callback, delay) {
        this.callback = callback;
        this.remaining = delay;
        this.resume();
    }

    /**
     * Pauses the timer marks whether the pause came from the player
     * or the system
     * @param {Boolean} systemPause
     */
    pause(systemPause) {
        window.clearTimeout(this.timerId);
        this.remaining -= new Date() - this.start;
        this.oldTimerId = this.timerId;

        if (systemPause) {
            this.pausedBySystem = true;
        }
    }

    /**
     * Creates a new setTimeout based upon the remaining time, giving the
     * illusion of 'resuming' the old setTimeout
     * @param {Boolean} systemResume
     */
    resume(systemResume) {
        if (systemResume || !this.pausedBySystem) {
            this.pausedBySystem = false;

            this.start = new Date();
            this.timerId = window.setTimeout(() => {
                this.callback();
                window.dispatchEvent(new CustomEvent('removeTimer', {
                    detail: {
                        timer: this,
                    },
                }));
            }, this.remaining);

            if (!this.oldTimerId) {
                window.dispatchEvent(new CustomEvent('addTimer', {
                    detail: {
                        timer: this,
                    },
                }));
            }
        }
    }
}

export { GameCoordinator };


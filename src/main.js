const ByteBuffer = require('bytebuffer');

const RecordClass = require('./enums/RecordClass');
const RecordType = require('./enums/RecordType');

function remapEnum(enumObj) {
	let keys = Object.keys(enumObj);
	keys.forEach((key) => {
		let value = enumObj[key];
		enumObj[value] = key;
	});
}

remapEnum(RecordClass);
remapEnum(RecordType);

function parse(buffer) {
	// https://www.rfc-editor.org/rfc/rfc1035#page-25

	buffer = ByteBuffer.wrap(buffer, ByteBuffer.BIG_ENDIAN);

	let header = {};
	header.id = buffer.readUint16();

	let byte = buffer.readUint8();
	header.isQuery = !(byte & 0b10000000);
	header.isResponse = !header.isQuery;

	header.opcode = (byte & 0b01111000) >> 3;
	header.authoritativeAnswer = !!(byte & 0b00000100);
	header.truncated = !!(byte & 0b00000010);
	header.recursionDesired = !!(byte & 0b00000001);

	byte = buffer.readUint8();
	header.recursionAvailable = !!(byte & 0b10000000);
	header.responseCode = byte & 0b00001111;

	header.questionCount = buffer.readUint16();
	header.answerCount = buffer.readUint16();
	header.authorityCount = buffer.readUint16();
	header.additionalCount = buffer.readUint16();

	let questions = [];
	for (let i = 0; i < header.questionCount; i++) {
		questions.push(readQuestion(buffer));
	}

	let answers = [];
	for (let i = 0; i < header.answerCount; i++) {
		answers.push(readResource(buffer));
	}

	let authorities = [];
	for (let i = 0; i < header.authorityCount; i++) {
		authorities.push(readResource(buffer));
	}

	let additionals = [];
	for (let i = 0; i < header.additionalCount; i++) {
		additionals.push(readResource(buffer));
	}

	return {
		header,
		questions,
		answers,
		authorities,
		additionals
	};
}

/**
 *
 * @param {ByteBuffer} buffer
 */
function readQuestion(buffer) {
	let name = readDomainLabels(buffer);
	let qType = buffer.readUint16();
	let qClass = buffer.readUint16();

	return {
		name,
		type: RecordType[qType] || qType,
		class: RecordClass[qClass] || qClass
	};
}

/**
 * @param {ByteBuffer} buffer
 */
function readResource(buffer) {
	let name = readDomainLabels(buffer);
	let type = buffer.readUint16();
	let cls = buffer.readUint16();
	let ttl = buffer.readUint32();
	let rdLength = buffer.readUint16();
	let recordData = buffer.slice(buffer.offset, buffer.offset + rdLength);
	let data = parseData(recordData.toBuffer(), RecordType[type] || type, buffer);
	buffer.skip(rdLength);

	return {
		name,
		type: RecordType[type] || type,
		class: RecordClass[cls] || cls,
		ttl,
		data
	};
}

/**
 * @param {ByteBuffer} buffer
 * @return string
 */
function readDomainLabels(buffer) {
	let labels = [];
	while (true) {
		let labelLength = buffer.readUint8();
		if (labelLength & 0b11000000) {
			// this is a pointer
			// ref: https://www.rfc-editor.org/rfc/rfc1035#page-30

			buffer.skip(-1);
			let pointer = buffer.readUint16() & 0x3fff;
			let ptrBuf = ByteBuffer.wrap(buffer.buffer, ByteBuffer.BIG_ENDIAN);
			ptrBuf.skip(pointer);
			let ptrLabels = readDomainLabels(ptrBuf).split('.');
			labels = labels.concat(ptrLabels);
			break;
		}

		if (labelLength == 0) {
			// end of labels
			break;
		}

		let label = buffer.readString(labelLength);
		labels.push(label);
	}

	return labels.join('.');
}

/**
 * @param {Buffer} dataBuffer
 * @param {string|number} recordType
 * @param {ByteBuffer} srcByteBuffer
 * @returns {*|string}
 */
function parseData(dataBuffer, recordType, srcByteBuffer) {
	switch (recordType) {
		case 'A':
			return Array.prototype.slice.call(dataBuffer).join('.');

		case 'TXT':
		case 'SPF':
			return dataBuffer.toString('utf8');

		case 'NS':
		case 'SOA':
		case 'CNAME':
		case 'PTR':
			let srcOffset = srcByteBuffer.offset;
			let nameResult = readDomainLabels(srcByteBuffer);
			srcByteBuffer.offset = srcOffset;
			return nameResult;

		default:
			return dataBuffer;
	}
}

exports.parse = parse;

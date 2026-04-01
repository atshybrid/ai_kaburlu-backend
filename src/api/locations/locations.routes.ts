
import { Router } from 'express';
import multer from 'multer';
import * as locationService from './locations.service';
import { CreateLocationDto, UpdateLocationDto } from './locations.dto';

const router = Router();
const upload = multer({ dest: 'uploads/' });

/**
 * @swagger
 * tags:
 *   name: Locations
 *   description: Location management
 */

/**
 * @swagger
 * /locations:
 *   post:
 *     summary: Create a new location
 *     tags: [Locations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateLocationDto'
 *     responses:
 *       201:
 *         description: The created location.
 */
router.post('/', async (req, res) => {
    try {
        const location = await locationService.createLocation(req.body as CreateLocationDto);
        res.status(201).json(location);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});


/**
 * @swagger
 * /locations:
 *   get:
 *     summary: Get all locations
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: The page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: The number of items to return
 *     responses:
 *       200:
 *         description: A list of locations.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Location'
 */
router.get('/', async (req, res) => {
    const { page, limit } = req.query;
    const options = {
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
    };
    const locations = await locationService.findAllLocations(options);
    res.json(locations);
});
/**
 * @swagger
 * /locations/{id}:
 *   get:
 *     summary: Get a location by ID
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The location ID
 *     responses:
 *       200:
 *         description: The location data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Location'
 *       404:
 *         description: Location not found
 */
router.get('/:id', async (req, res) => {
    const location = await locationService.findLocationById(req.params.id);
    if (location) {
        res.json(location);
    } else {
        res.status(404).send('Location not found');
    }
})

/**
 *   patch:
 *     summary: Update a location by ID
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The location ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateLocationDto'
 *     responses:
 *       200:
 *         description: The updated location.
 *       404:
 *         description: Location not found
 */
router.patch('/:id', async (req, res) => {
    try {
        const location = await locationService.updateLocation(req.params.id, req.body as UpdateLocationDto);
        res.json(location);
    } catch (error) {
        res.status(404).send('Location not found');
    }
})

/**
 *   delete:
 *     summary: Delete a location by ID
 *     tags: [Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The location ID
 *     responses:
 *       204:
 *         description: No content
 *       404:
 *         description: Location not found
 */
router.delete('/:id', async (req, res) => {
    try {
        await locationService.deleteLocation(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(404).send('Location not found');
    }
});
/**
 *   post:
 *     summary: Bulk upload locations via CSV file
 *     tags: [Locations]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The CSV file to upload.
 *     responses:
 *       200:
 *         description: Locations uploaded successfully.
 *       400:
 *         description: Bad request, please check the file format.
 *     x-csv-example:
 *       name,code,type,level,stateId,parentId
 *       Adilabad,ADL,district,1,clxys930c0000vc11h2g5g4g3,
 *       Boath,BTH,assembly,2,clxys930c0000vc11h2g5g4g3,clxyz12340001vc11abcd_ADL
 *       Nirmal,NRL,district,1,clxys930c0000vc11h2g5g4g3,
 *       Mudhole,MDH,assembly,2,clxys930c0000vc11h2g5g4g3,clxyz56780002vc11efgh_NRL
 *     x-field-explanations:
 *       - name: The name of the location (e.g., "Adilabad").
 *       - code: A unique code for the location (e.g., "ADL").
 *       - type: The type of location. Must be one of: country, state, district, assembly, mandal, village.
 *       - level: The hierarchical level of the location (e.g., 1 for district, 2 for assembly).
 *       - stateId: The ID of the state this location belongs to.
 *       - parentId: The ID of the parent location (optional).
 */
router.post('/bulk-upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        const result = await locationService.bulkUploadLocations(req.file.path);
        res.status(200).json({ message: 'Locations uploaded successfully', result });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * @swagger
 * /locations/districts/bulk-upload:
 *   post:
 *     summary: Bulk upload districts via CSV file
 *     tags: [Locations]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV file with district data.
 *     responses:
 *       200:
 *         description: Districts uploaded successfully.
 *       400:
 *         description: Bad request, please check the file format.
 *     x-csv-example:
 *       districtName,stateId,stateName
 *       Bengaluru Urban,,Karnataka
 *       Mysuru,,Karnataka
 *       Hassan,,Karnataka
 *       Tumakuru,,Karnataka
 *       Ramanagara,,Karnataka
 *       Shivamogga,,Karnataka
 *     x-field-explanations:
 *       - districtName: The district name to insert (required).
 *       - stateId: The ID of the state (optional if stateName provided).
 *       - stateName: The name of the state (optional if stateId provided). When both are present, stateId takes precedence.
 */
router.post('/districts/bulk-upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    try {
        const result = await locationService.bulkUploadDistricts(req.file.path);
        res.status(200).json({ message: 'Districts uploaded successfully', result });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});
export default router;
